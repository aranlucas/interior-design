// One Railway replica shares a memory budget across all users and job types.
// Keep ownership until settlement, including provider abort/cleanup; timeouts must
// not admit another job while the previous request still holds its buffers.
const runtime = globalThis as typeof globalThis & { roomformHeavyWork?: symbol };

export function acquireHeavyWork() {
  if (runtime.roomformHeavyWork)
    throw new Response("The server is finishing another design or 3D build. Try again shortly.", {
      status: 409,
    });
  const token = Symbol();
  runtime.roomformHeavyWork = token;
  return () => {
    if (runtime.roomformHeavyWork === token) delete runtime.roomformHeavyWork;
  };
}
