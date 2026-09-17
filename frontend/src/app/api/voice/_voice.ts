// Re-exports so v1 routes can import voice context helpers with a short path.
export {
  auditedToolCall,
  listAccessibleBusinesses,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
  type Db,
  type VoiceBusinessRow,
  type VoiceContext,
  VoiceAuthError,
} from "../../../lib/voice/context";
