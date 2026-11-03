import { describe, expect, it, vi } from "vitest";
import { applyWatchedJob, observeJob } from "./watched-job";
import { generationInterval } from "./studio-queries";
import type { GenerationJob, Room } from "./types";
const job = (id: string, status: GenerationJob["status"]): GenerationJob => ({
  id,
  status,
  roomId: "room",
  owner: "owner",
  error: null,
  designId: null,
  createdAt: "",
  updatedAt: "",
});
describe("generation jobs watched by this tab", () => {
  it("handles failure of a started job but ignores unrelated terminal jobs", () => {
    expect(observeJob("a", job("b", "failed")).act).toBe(false);
    expect(observeJob("a", null).act).toBe(false);
    expect(observeJob("a", job("a", "failed"))).toEqual({ watching: undefined, act: true });
    expect(observeJob("a", job("b", "running"))).toEqual({ watching: "b", act: false });
  });
});

describe("applying committed job results", () => {
  const room: Room = {
    id: "room",
    name: "Room",
    type: "Living room",
    notes: "",
    style: "",
    assets: [],
    designs: [],
    createdAt: "",
  };
  const actions = () => ({
    update: vi.fn(async () => {}),
    currentRoom: () => "room",
    showDesign: vi.fn(),
    onError: vi.fn(),
  });

  it("does not write rooms, change views, or toast for old terminal jobs", async () => {
    const watching = { current: undefined as string | undefined };
    const handlers = actions();
    for (const status of ["succeeded", "failed"] as const)
      await applyWatchedJob(watching, { job: job("old", status), room }, handlers);
    expect(handlers.update).not.toHaveBeenCalled();
    expect(handlers.showDesign).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
  it("writes confirmed data before switching view and consumes completion once", async () => {
    const watching = { current: undefined as string | undefined };
    const handlers = actions();
    await applyWatchedJob(watching, { job: job("a", "running") }, handlers);
    const result = { job: { ...job("a", "succeeded"), designId: "design" }, room };
    const first = applyWatchedJob(watching, result, handlers);
    expect(handlers.showDesign).not.toHaveBeenCalled();
    await Promise.all([first, applyWatchedJob(watching, result, handlers)]);
    expect(handlers.update).toHaveBeenCalledExactlyOnceWith(room);
    expect(handlers.showDesign).toHaveBeenCalledExactlyOnceWith("design");
  });
  it("does not switch a different room, including switches while the DB write settles", async () => {
    const watching = { current: "a" as string | undefined };
    let selected = "room";
    let finish!: () => void;
    const handlers = {
      ...actions(),
      currentRoom: () => selected,
      update: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    };
    const pending = applyWatchedJob(watching, { job: job("a", "succeeded"), room }, handlers);
    selected = "other room";
    finish();
    await pending;
    expect(handlers.showDesign).not.toHaveBeenCalled();
  });
  it("reports watched failures once and stops polling terminal or absent jobs", async () => {
    const watching = { current: "a" as string | undefined };
    const handlers = actions();
    const result = { job: { ...job("a", "failed"), error: "Provider failed" } };
    await applyWatchedJob(watching, result, handlers);
    await applyWatchedJob(watching, result, handlers);
    expect(handlers.onError).toHaveBeenCalledExactlyOnceWith("Provider failed");
    expect(generationInterval({ job: job("a", "running") })).toBe(3000);
    expect(generationInterval(result)).toBe(false);
    expect(generationInterval({ job: job("a", "succeeded") })).toBe(false);
    expect(generationInterval({ job: null })).toBe(false);
    expect(generationInterval(undefined)).toBe(false);
  });
});
