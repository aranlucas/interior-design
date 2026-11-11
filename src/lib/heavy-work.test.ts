import { expect, it } from "vitest";
import { acquireHeavyWork } from "./heavy-work.server";

// Exclusivity must survive long jobs; an old cleanup must not unlock a newer job.
it("keeps a single processing slot until its owner releases it", () => {
  const release = acquireHeavyWork();
  try {
    expect(() => acquireHeavyWork()).toThrow();
  } finally {
    release();
  }
  const next = acquireHeavyWork();
  try {
    release();
    expect(() => acquireHeavyWork()).toThrow();
  } finally {
    next();
  }
  acquireHeavyWork()();
});
