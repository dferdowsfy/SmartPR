// Compatibility re-export. The xAI client now lives behind the AI provider
// layer (src/lib/ai/providers/xai.ts); new code should call the router in
// src/lib/ai/router.ts rather than the vendor client.
export * from "../../lib/ai/providers/xai";
