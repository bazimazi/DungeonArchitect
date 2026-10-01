export const CLIENT_EVENTS = [
  "EditorOpened",
  "EditorSession",
  "DungeonCreated",
  "ObjectPlaced",
  "ObjectRemoved",
  "PublishFailed",
  "TutorialStep",
  "DungeonShared",
  "DiscoverySearched",
  "MechanicConfigured",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];
