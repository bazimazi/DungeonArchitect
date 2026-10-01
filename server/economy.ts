import { COSMETICS, currentSeason } from "../src/shared/economy";
import type { CosmeticInventory } from "../src/shared/economy";
import type { UserRow } from "./auth";
import { Database } from "./database";
import { ProgressionService } from "./progression";
import { ApiError, objectBody } from "./errors";

export class EconomyService {
  constructor(
    private db: Database,
    private progression: ProgressionService,
    private now: () => Date,
  ) {}
  inventory(user: UserRow): CosmeticInventory {
    return {
      owned: this.db
        .all<{ item_id: string }>(
          "SELECT item_id FROM cosmetics WHERE user_id=?",
          user.id,
        )
        .map((r) => r.item_id),
      equipped:
        this.db.get<{ item_id: string }>(
          "SELECT item_id FROM equipped_cosmetics WHERE user_id=?",
          user.id,
        )?.item_id ?? null,
    };
  }
  catalog(user: UserRow | null) {
    return {
      items: COSMETICS,
      inventory: user ? this.inventory(user) : null,
      season: currentSeason(this.now()),
    };
  }
  buy(user: UserRow, input: unknown): CosmeticInventory {
    const item = COSMETICS.find((item) => item.id === objectBody(input).itemId);
    if (!item)
      throw new ApiError(
        404,
        "item_not_found",
        "That cosmetic does not exist.",
      );
    return this.db.transaction(() => {
      if (this.inventory(user).owned.includes(item.id))
        return this.inventory(user);
      const wallet = this.progression.profile(user.id);
      if (
        wallet.gold < item.gold ||
        wallet.materials < item.materials ||
        wallet.essence < item.essence
      )
        throw new ApiError(
          400,
          "insufficient_funds",
          "Earn more currency by creating and completing dungeons.",
        );
      this.progression.grant(user.id, "cosmetic", item.id, {
        xp: 0,
        gold: -item.gold,
        materials: -item.materials,
        essence: -item.essence,
      });
      this.db.run(
        "INSERT INTO cosmetics VALUES(?,?,?)",
        user.id,
        item.id,
        this.now().toISOString(),
      );
      return this.inventory(user);
    });
  }
  equip(user: UserRow, input: unknown): CosmeticInventory {
    const id = objectBody(input).itemId;
    if (id === null)
      this.db.run("DELETE FROM equipped_cosmetics WHERE user_id=?", user.id);
    else {
      if (typeof id !== "string" || !this.inventory(user).owned.includes(id))
        throw new ApiError(
          400,
          "not_owned",
          "Unlock this cosmetic before equipping it.",
        );
      this.db.run(
        "INSERT INTO equipped_cosmetics VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET item_id=excluded.item_id",
        user.id,
        id,
      );
    }
    return this.inventory(user);
  }
}
