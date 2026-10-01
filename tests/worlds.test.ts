import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server/app";
import { createStarter } from "../src/core/dungeon";
import { createTemplate, TEMPLATES } from "../src/core/templates";
import { validateDungeon } from "../src/core/validation";
import { simulateAdventurer } from "../src/core/adventurers";
import type { Campaign, SharedWorkshop } from "../src/shared/worlds";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
});
async function setup() {
  const s = await buildServer({ databasePath: ":memory:", rateLimits: false });
  servers.push(s);
  return s;
}
async function user(s: Awaited<ReturnType<typeof setup>>, handle: string) {
  const r = await s.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      handle,
      displayName: handle,
      password: "Tests only passphrase 2026",
    },
  });
  return {
    cookie: String(r.headers["set-cookie"]).split(";")[0],
    id: r.json().id,
  };
}

describe("shared creation and earned cosmetics", () => {
  it("lets guild members contribute their own worlds and reserves removal for creator or guild leader", async () => {
    const s = await setup(),
      leader = await user(s, "leader"),
      member = await user(s, "builder"),
      stranger = await user(s, "outside");
    const guildAction = (cookie: string, payload: object) =>
      s.app.inject({
        method: "POST",
        url: "/api/guilds",
        headers: { cookie },
        payload,
      });
    const guild = (
      await guildAction(leader.cookie, {
        action: "create",
        name: "Connected worlds",
      })
    ).json()[0];
    const campaign = (
      await s.app.inject({
        method: "POST",
        url: "/api/campaigns",
        headers: { cookie: member.cookie },
        payload: {
          title: "Our adventure",
          description: "An interconnected world",
          nodes: [],
          expectedRevision: 0,
        },
      })
    ).json();
    expect(
      (
        await guildAction(member.cookie, {
          action: "attach-world",
          id: guild.id,
          campaignId: campaign.id,
        })
      ).statusCode,
    ).toBe(404);
    await guildAction(member.cookie, { action: "join", code: guild.code });
    const attached = await guildAction(member.cookie, {
      action: "attach-world",
      id: guild.id,
      campaignId: campaign.id,
    });
    expect(attached.statusCode, attached.body).toBe(200);
    expect(attached.json()[0].worlds[0].id).toBe(campaign.id);
    await guildAction(stranger.cookie, { action: "join", code: guild.code });
    expect(
      (
        await guildAction(stranger.cookie, {
          action: "remove-world",
          id: guild.id,
          campaignId: campaign.id,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await guildAction(leader.cookie, {
          action: "remove-world",
          id: guild.id,
          campaignId: campaign.id,
        })
      ).json()[0].worlds,
    ).toEqual([]);
  });
  it("requires accepted invitations, protects private projects, and rejects stale edits", async () => {
    const s = await setup(),
      owner = await user(s, "owner"),
      co = await user(s, "coarchitect"),
      other = await user(s, "stranger");
    const created = await s.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner.cookie },
      payload: { dungeon: createStarter() },
    });
    expect(created.statusCode).toBe(200);
    const p = created.json<SharedWorkshop>();
    expect(
      (
        await s.app.inject({
          url: `/api/projects/${p.id}`,
          headers: { cookie: other.cookie },
        })
      ).statusCode,
    ).toBe(404);
    await s.app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { action: "invite", handle: "coarchitect" },
    });
    const save = () =>
      s.app.inject({
        method: "PUT",
        url: `/api/projects/${p.id}`,
        headers: { cookie: co.cookie },
        payload: {
          dungeon: { ...p.dungeon, title: "Together" },
          expectedRevision: 1,
        },
      });
    expect((await save()).statusCode).toBe(403);
    await s.app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/members`,
      headers: { cookie: co.cookie },
      payload: { action: "accept" },
    });
    expect((await save()).json().revision).toBe(2);
    expect((await save()).statusCode).toBe(409);
    const state = (
      await s.app.inject({
        url: `/api/projects/${p.id}`,
        headers: { cookie: owner.cookie },
      })
    ).json<SharedWorkshop>();
    expect(state.dungeon.title).toBe("Together");
    expect(state.revision).toBe(2);
  });
  it("uses immutable campaign chapters and verified prerequisite progress, and rejects cycles", async () => {
    const s = await setup(),
      owner = await user(s, "owner"),
      player = await user(s, "player");
    const dungeon = createStarter();
    const publication = (
      await s.app.inject({
        method: "POST",
        url: "/api/dungeons/publish",
        headers: { cookie: owner.cookie },
        payload: {
          dungeon,
          proof: simulateAdventurer(dungeon, "draft", 4, 3),
          tags: [],
        },
      })
    ).json();
    const nodes = [
      {
        id: "start",
        versionId: publication.card.versionId,
        title: "The first gate",
        story: "Enter the crypt.",
        condition: "clear",
      },
      {
        id: "finish",
        versionId: publication.card.versionId,
        title: "The return",
        story: "The path remembers.",
        condition: "clear",
        requires: "start",
      },
    ];
    const campaign = (
      await s.app.inject({
        method: "POST",
        url: "/api/campaigns",
        headers: { cookie: owner.cookie },
        payload: {
          title: "Two journeys",
          description: "A test campaign",
          nodes,
          expectedRevision: 0,
        },
      })
    ).json<Campaign>();
    expect(campaign.progress![1].available).toBe(false);
    const cyclic = await s.app.inject({
      method: "PUT",
      url: `/api/campaigns/${campaign.id}`,
      headers: { cookie: owner.cookie },
      payload: {
        ...campaign,
        expectedRevision: 1,
        nodes: [{ ...nodes[0], requires: "finish" }, nodes[1]],
      },
    });
    expect(cyclic.statusCode).toBe(400);
    const ticket = (
      await s.app.inject({
        method: "POST",
        url: `/api/versions/${publication.card.versionId}/attempts`,
        headers: { cookie: player.cookie },
      })
    ).json();
    const replay = simulateAdventurer(
      ticket.dungeon,
      ticket.versionId,
      ticket.seed,
      3,
    );
    await s.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: player.cookie },
      payload: { actions: replay.actions },
    });
    const progress = (
      await s.app.inject({
        url: `/api/campaigns/${campaign.id}`,
        headers: { cookie: player.cookie },
      })
    ).json<Campaign>();
    expect(progress.progress![1].available).toBe(true);
  });
  it("debits cosmetics atomically and never sells gameplay stats", async () => {
    const s = await setup(),
      p = await user(s, "collector");
    const purchase = () =>
      s.app.inject({
        method: "POST",
        url: "/api/shop/buy",
        headers: { cookie: p.cookie },
        payload: { itemId: "moss-banner", price: 0 },
      });
    expect((await purchase()).statusCode).toBe(400);
    s.progression.grant(p.id, "test", "wallet", {
      xp: 0,
      gold: 50,
      materials: 0,
      essence: 0,
    });
    expect((await purchase()).json().owned).toEqual(["moss-banner"]);
    expect((await purchase()).json().owned).toEqual(["moss-banner"]);
    expect(s.progression.profile(p.id).gold).toBe(20);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/shop/equip",
          headers: { cookie: p.cookie },
          payload: { itemId: "star-banner" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/shop/equip",
          headers: { cookie: p.cookie },
          payload: { itemId: "moss-banner" },
        })
      ).json().equipped,
    ).toBe("moss-banner");
  });
  it("uses invitation codes for guilds and authenticates native sessions without browser cookies", async () => {
    const s = await setup(),
      owner = await user(s, "guildmaster"),
      member = await user(s, "member");
    const guild = (
      await s.app.inject({
        method: "POST",
        url: "/api/guilds",
        headers: { cookie: owner.cookie },
        payload: { action: "create", name: "The Cartographers" },
      })
    ).json()[0];
    const joined = await s.app.inject({
      method: "POST",
      url: "/api/guilds",
      headers: { cookie: member.cookie },
      payload: { action: "join", code: guild.code },
    });
    expect(joined.json()[0].members).toHaveLength(2);
    const login = await s.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-dungeon-native": "1" },
      payload: { handle: "member", password: "Tests only passphrase 2026" },
    });
    const token = String(login.headers["x-dungeon-session"]);
    expect(token.length).toBeGreaterThan(30);
    expect(
      (
        await s.app.inject({
          url: "/api/me",
          headers: { authorization: `Bearer ${token}` },
        })
      ).json().player.id,
    ).toBe(member.id);
    await s.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(
      (
        await s.app.inject({
          url: "/api/me",
          headers: { authorization: `Bearer ${token}` },
        })
      ).json().player,
    ).toBeNull();
  });
  it("provides valid seeded templates and retains their distinct objectives", () => {
    for (const template of TEMPLATES) {
      const dungeon = createTemplate(template.id, 997);
      expect(validateDungeon(dungeon).valid, template.id).toBe(true);
    }
    expect(createTemplate("boss-rush").objective?.kind).toBe("defeat-all");
    expect(createTemplate("survival").objective?.ticks).toBe(30);
    expect(createTemplate("maze", 12).tiles).toEqual(
      createTemplate("maze", 12).tiles,
    );
    expect(createTemplate("maze", 13).tiles).not.toEqual(
      createTemplate("maze", 12).tiles,
    );
  });
});
