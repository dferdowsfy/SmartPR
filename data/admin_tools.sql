-- ============================================================================
-- SmartPR admin toolkit — run once per database (safe to re-run).
-- Gives the founder full user/plan management from the Supabase dashboard:
--
--   Table Editor -> admin_user_overview   (find any user, see workspace+plan)
--   SQL Editor:
--     SELECT admin_set_plan('user@example.com', 'core');
--       -- plans: free|core|operator|partner|pilot|enterprise
--     SELECT admin_revoke_plan('user@example.com');
--       -- downgrades to free. If they pay via Stripe, cancel the Stripe
--       -- subscription too, or the billing webhook will re-grant the plan.
--     SELECT admin_delete_user('user@example.com');
--       -- deletes the auth user; removes sole-owned workspaces and all
--       -- their data; only revokes membership on shared workspaces.
--       -- Refuses to delete anyone holding the admin group.
-- ============================================================================

-- 1) One row per user per workspace: who they are, what plan they're on ----
CREATE OR REPLACE VIEW admin_user_overview AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS user_created_at,
  w.id AS workspace_id,
  w.name AS workspace_name,
  wm.role AS member_role,
  ws.plan,
  ws.status AS subscription_status,
  (ws.stripe_customer_id IS NOT NULL) AS has_stripe_customer,
  (
    SELECT COUNT(*)
    FROM businesses b
    WHERE b.workspace_id = w.id AND b.archived = false
  ) AS business_count
FROM auth.users u
LEFT JOIN workspace_members wm ON wm.user_id = u.id
LEFT JOIN workspaces w ON w.id = wm.workspace_id
LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id;

-- 2) Set a user's plan on their primary (owner-first) workspace --------------
CREATE OR REPLACE FUNCTION admin_set_plan(p_email TEXT, p_plan TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_workspace_id UUID;
  v_plan TEXT := lower(trim(p_plan));
BEGIN
  IF v_plan NOT IN ('free', 'core', 'operator', 'partner', 'pilot', 'enterprise') THEN
    RAISE EXCEPTION 'Unknown plan "%". Use free|core|operator|partner|pilot|enterprise.', p_plan;
  END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email "%".', p_email;
  END IF;
  SELECT w.id INTO v_workspace_id
  FROM workspaces w
  JOIN workspace_members wm ON wm.workspace_id = w.id
  WHERE wm.user_id = v_user_id
  ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END, w.created_at ASC
  LIMIT 1;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'User "%" has no workspace.', p_email;
  END IF;
  INSERT INTO workspace_subscriptions (workspace_id, plan, status, updated_at)
  VALUES (v_workspace_id, v_plan, CASE WHEN v_plan = 'free' THEN 'free' ELSE 'active' END, NOW())
  ON CONFLICT (workspace_id) DO UPDATE SET
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    updated_at = NOW();
  RETURN format('Plan for %s set to %s (workspace %s).', p_email, v_plan, v_workspace_id);
END;
$$;

-- 3) Revoke a user's plan (downgrade to free) --------------------------------
CREATE OR REPLACE FUNCTION admin_revoke_plan(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NOTE: if the customer pays through Stripe, cancel the subscription in the
  -- Stripe dashboard too; otherwise the billing webhook will re-grant the plan.
  RETURN admin_set_plan(p_email, 'free');
END;
$$;

-- 4) Delete a user and their data --------------------------------------------
CREATE OR REPLACE FUNCTION admin_delete_user(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT := lower(trim(p_email));
  v_ws RECORD;
  v_member_count INT;
  v_deleted_ws INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM admin_allowlist
    WHERE lower(email) = v_email
      AND EXISTS (SELECT 1 FROM unnest(groups) AS g WHERE lower(trim(g)) = 'admin')
  ) THEN
    RAISE EXCEPTION 'Refusing to delete %: they hold the admin group. Remove it from admin_allowlist first.', p_email;
  END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email "%".', p_email;
  END IF;

  FOR v_ws IN
    SELECT w.id, w.owner_user_id
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = v_user_id
  LOOP
    SELECT COUNT(*) INTO v_member_count FROM workspace_members WHERE workspace_id = v_ws.id;
    IF v_member_count <= 1 THEN
      -- Sole member: remove the whole workspace and its data.
      -- businesses cascades to matters, obligations, evidence, notifications.
      DELETE FROM businesses WHERE workspace_id = v_ws.id;
      DELETE FROM workspace_subscriptions WHERE workspace_id = v_ws.id;
      DELETE FROM workspaces WHERE id = v_ws.id; -- cascades workspace_members
      v_deleted_ws := v_deleted_ws + 1;
    ELSE
      -- Shared workspace: only revoke their membership, keep the workspace.
      DELETE FROM workspace_members WHERE workspace_id = v_ws.id AND user_id = v_user_id;
    END IF;
  END LOOP;

  -- Keep the founder's lead records, but unlink them from the deleted user.
  UPDATE leads SET user_id = NULL WHERE user_id = v_user_id;

  DELETE FROM auth.identities WHERE user_id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN format(
    'Deleted user %s (%s). Removed %s sole-owned workspace(s); shared workspaces kept, membership revoked.',
    p_email, v_user_id, v_deleted_ws
  );
END;
$$;
