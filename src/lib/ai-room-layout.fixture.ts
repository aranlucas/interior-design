import type { AiRoomLayout } from "./ai-room-layout";

export function exampleAiRoomLayout(): AiRoomLayout {
  return {
    summary: "An estimated open room with an island and a rear window.",
    assumptions: ["All proportions are estimated from photos."],
    footprint: [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 6 },
      { x: 0, z: 6 },
    ],
    ceilingHeight: 2.6,
    floorColor: "#c2a47b",
    walls: Array.from({ length: 4 }, (_, edgeIndex) => ({
      edgeIndex,
      label: `Wall ${edgeIndex + 1}`,
      color: "#eeeae2",
      support: edgeIndex < 2 ? "visible" : "inferred",
      photoNumbers: edgeIndex < 2 ? [1] : [],
      openings:
        edgeIndex === 0
          ? [
              {
                kind: "window",
                center: 0.5,
                width: 1.2,
                bottom: 1,
                height: 1.1,
                support: "visible",
                photoNumbers: [1],
              },
            ]
          : [],
    })),
    fixtures: [
      {
        label: "Island",
        kind: "island",
        x: 2,
        z: 3,
        bottom: 0,
        width: 1.5,
        depth: 0.8,
        height: 0.9,
        yawDegrees: 0,
        color: "#ece7de",
        support: "visible",
        photoNumbers: [1],
      },
    ],
    cameras: [
      {
        photoNumber: 1,
        x: 2,
        z: 0.4,
        height: 1.5,
        yawDegrees: 0,
        hfovDegrees: 70,
        leftToRight: ["Island"],
      },
    ],
  };
}

/** Reduced from the listing layout that exposed the left/right orientation bug. */
export function exampleListingRoomLayout(): AiRoomLayout {
  const layout = exampleAiRoomLayout();
  layout.footprint = [
    { x: 0, z: 0 },
    { x: 5.2, z: 0 },
    { x: 5.2, z: 10 },
    { x: 0, z: 10 },
  ];
  layout.ceilingHeight = 2.7;
  layout.walls.forEach((wall) => {
    wall.support = "visible";
    wall.photoNumbers = [1];
    wall.openings = [];
  });
  const door = {
    kind: "door" as const,
    bottom: 0,
    height: 2.25,
    support: "visible" as const,
    photoNumbers: [1],
  };
  layout.walls[0].openings = [{ ...door, center: 0.6442, width: 2.1 }];
  layout.walls[2].openings = [{ ...door, center: 0.2308, width: 1.8 }];
  layout.fixtures = [
    {
      ...layout.fixtures[0],
      kind: "stairs",
      label: "Stairs rising toward kitchen",
      x: 0.5,
      z: 4.05,
      width: 1,
      depth: 2.7,
      height: 2.5,
    },
  ];
  return layout;
}
