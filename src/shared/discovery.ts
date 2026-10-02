export const DIFFICULTY_PREFERENCES = [
  "adaptive",
  "any",
  "Very easy",
  "Easy",
  "Moderate",
  "Hard",
  "Extreme",
] as const;
export const SESSION_PREFERENCES = [
  "adaptive",
  "any",
  "short",
  "medium",
  "long",
] as const;
export interface DiscoveryPreferences {
  difficulty: (typeof DIFFICULTY_PREFERENCES)[number];
  session: (typeof SESSION_PREFERENCES)[number];
}
export const DEFAULT_DISCOVERY: DiscoveryPreferences = {
  difficulty: "adaptive",
  session: "adaptive",
};
