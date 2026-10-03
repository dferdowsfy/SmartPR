import { redirect } from "next/navigation";

/** /rehearsal-portal/ogpe → the OGPe clone's login step. */
export default function OgpeRehearsalIndex() {
  redirect("/rehearsal-portal/ogpe/tramite?step=login");
}
