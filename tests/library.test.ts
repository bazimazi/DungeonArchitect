import { describe, expect, it } from "vitest";
import { simulateAdventurer } from "../src/core/adventurers";
import { clone } from "../src/core/types";
import { Library, STORAGE_KEY } from "../src/services/library";
import { analyze } from "../src/services/analytics";
import { Simulation } from "../src/core/simulation";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
function certificate(library: Library) {
  return simulateAdventurer(library.data.draft, "draft", 11, 3);
}
describe("local publishing and replay service", () => {
  it("requires personal completion, preserves old versions, and invalidates proof on edit", () => {
    const library = new Library(memoryStorage());
    expect(() => library.publish()).toThrow("publish.testRequired");
    library.certify(certificate(library));
    const first = library.publish();
    expect(() => library.publish()).toThrow("publish.unchanged");
    const changed = clone(library.data.draft);
    changed.title = "Version two";
    library.updateDraft(changed);
    expect(library.tested).toBe(false);
    expect(() => library.publish()).toThrow("publish.testRequired");
    library.certify(certificate(library));
    const second = library.publish();
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(library.data.versions[0].dungeon.title).toBe("Mossveil Crypt");
  });
  it("derives analytics from verified actions and rejects attempts for another snapshot", () => {
    const library = new Library(memoryStorage());
    library.certify(certificate(library));
    const version = library.publish();
    const replay = simulateAdventurer(version.dungeon, version.id, 12, 0);
    library.record(replay);
    library.record(replay);
    expect(analyze(library.data.attempts)).toMatchObject({
      attempts: 1,
      completions: 1,
      completionRate: 100,
    });
    const tampered = clone(replay);
    tampered.id = "tampered";
    tampered.dungeon.title = "different";
    expect(() => library.record(tampered)).toThrow("storage.invalidReplay");
  });
  it("survives reload and keeps a failed storage write playable with an explicit warning", () => {
    const storage = memoryStorage();
    const library = new Library(storage);
    library.certify(certificate(library));
    library.publish();
    const restored = new Library(storage);
    expect(restored.tested).toBe(true);
    expect(restored.data.versions).toHaveLength(1);
    const failed = new Library({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(failed.persist()).toBe(false);
    expect(failed.warning).toBe("storage.saveFailed");
    storage.setItem(STORAGE_KEY, "{broken");
    expect(new Library(storage).warning).not.toBeNull();
  });
  it("rejects a forged completion and extra actions after a terminal state", () => {
    const library = new Library(memoryStorage());
    const proof = certificate(library);
    expect(() => library.certify({ ...proof, actions: [] })).toThrow(
      "publish.testRequired",
    );
    expect(() =>
      library.certify({
        ...proof,
        actions: [...proof.actions, { type: "wait" }],
      }),
    ).toThrow("storage.invalidReplay");
  });
  it("derives death heatmaps from real damage and restores bounded personal test recordings", () => {
    const storage = memoryStorage();
    const library = new Library(storage);
    const sim = new Simulation(library.data.draft, 24);
    sim.step({ type: "move", direction: "down" });
    for (let i = 0; i < 7; i++) sim.step({ type: "move", direction: "right" });
    while (sim.state.status === "playing") sim.step({ type: "wait" });
    const replay = sim.replay();
    library.recordPractice(replay);
    const stats = analyze([replay]);
    expect(stats.deaths).toBe(1);
    expect(stats.completionRate).toBe(0);
    expect(stats.deathCells.get("9,3")).toEqual({
      point: { x: 9, y: 3 },
      count: 1,
    });
    expect(stats.deadliest?.objectId).toBe(
      sim.dungeon.objects.find((o) => o.type === "skeleton")!.id,
    );
    expect(new Library(storage).data.practice).toEqual([replay]);
  });
});
