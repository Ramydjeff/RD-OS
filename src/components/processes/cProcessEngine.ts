// Compatibility entry point. The former regex-based analyser was replaced by a
// real C interpreter running on a simulated UNIX kernel: see ./engine.
export * from "@/components/processes/engine";
