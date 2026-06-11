import {
	action,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
	type KeyDownEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";

import { readRtk, readGraphify, readCodegraph, formatCompact, formatMoney } from "./sources";
import { renderKey } from "./render";

type Mode =
	| "cycle"
	| "rtk"
	| "graphify"
	| "codegraph"
	| "total"
	| "today"
	| "gfytoday"
	| "cgtoday"
	| "todaytotal"
	| "week"
	| "month"
	| "money"
	| "combined";

type Settings = {
	mode?: Mode;
	rtkCommand?: string;
	pollSeconds?: number | string;
	gfyPerQuery?: number | string;
	gfyQueries?: number | string;
	gfyStatsPath?: string;
	gfyCostPath?: string;
	cgPerQuery?: number | string;
	cgQueries?: number | string;
	cgStatsPath?: string;
	usdPerMTokens?: number | string;
};

/**
 * Minimal structural view of a key action. We only ever attach this action to a Keypad
 * controller (see the manifest), so a key is guaranteed at runtime.
 */
type KeyLike = {
	id: string;
	setImage(image: string): Promise<void>;
	setTitle(title: string): Promise<void>;
};

const ORDER = [
	"rtk",
	"graphify",
	"codegraph",
	"total",
	"today",
	"gfytoday",
	"cgtoday",
	"todaytotal",
	"week",
	"month",
	"money",
] as const;
type View = (typeof ORDER)[number];

/** Default location the `track-graphify` hook writes the live query counter to. */
const DEFAULT_STATS_PATH = "~/.tokensaver/graphify.json";
/** Default location the `track-codegraph` hook writes its live query counter to. */
const DEFAULT_CG_STATS_PATH = "~/.tokensaver/codegraph.json";

const COLOR: Record<View | "error", string> = {
	rtk: "#34d399", // green  — measured
	graphify: "#fbbf24", // amber  — estimate
	codegraph: "#a3e635", // lime   — estimate (100% local, no cost)
	total: "#60a5fa", // blue   — combined
	today: "#a78bfa", // violet — RTK measured today
	gfytoday: "#fcd34d", // amber  — Graphify today (estimate)
	cgtoday: "#bef264", // lime   — CodeGraph today (estimate)
	todaytotal: "#818cf8", // indigo — all three, today (≈)
	week: "#f472b6", // pink
	month: "#38bdf8", // sky
	money: "#facc15", // gold
	error: "#f87171", // red
};

@action({ UUID: "com.tokensaver.dashboard.savings" })
export class TokenSavings extends SingletonAction<Settings> {
	/** One refresh timer per visible key instance. */
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
	/** Current position in the cycle, per key instance (only used in "cycle" mode). */
	private readonly cycle = new Map<string, number>();

	override onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		const a = ev.action as unknown as KeyLike;
		this.schedule(a, ev.payload.settings);
		return this.refresh(a, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		const id = ev.action.id;
		const t = this.timers.get(id);
		if (t) clearInterval(t);
		this.timers.delete(id);
		this.cycle.delete(id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		const a = ev.action as unknown as KeyLike;
		this.schedule(a, ev.payload.settings); // poll interval may have changed
		return this.refresh(a, ev.payload.settings);
	}

	override onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const a = ev.action as unknown as KeyLike;
		// In cycle mode a tap advances the readout; pinned modes just force a refresh.
		if ((ev.payload.settings.mode ?? "cycle") === "cycle") {
			this.cycle.set(a.id, ((this.cycle.get(a.id) ?? 0) + 1) % ORDER.length);
		}
		return this.refresh(a, ev.payload.settings);
	}

	private schedule(a: KeyLike, s: Settings): void {
		const prev = this.timers.get(a.id);
		if (prev) clearInterval(prev);
		const secs = Math.max(5, num(s.pollSeconds, 30));
		this.timers.set(
			a.id,
			setInterval(() => void this.refresh(a, s), secs * 1000),
		);
	}

	private view(id: string, s: Settings): View {
		const m = s.mode ?? "cycle";
		if (m === "cycle") return ORDER[this.cycle.get(id) ?? 0];
		if (m === "combined") return "total"; // back-compat with the old mode name
		return m as View;
	}

	private async refresh(a: KeyLike, s: Settings): Promise<void> {
		const cmd = (s.rtkCommand ?? "").trim() || "rtk gain";
		const perQuery = num(s.gfyPerQuery, 121_300) || 121_300;
		const queries = num(s.gfyQueries, 0);
		const statsPath = (s.gfyStatsPath ?? "").trim() || DEFAULT_STATS_PATH;
		const costPath = (s.gfyCostPath ?? "").trim() || undefined;
		const cgPerQuery = num(s.cgPerQuery, 100_000) || 100_000;
		const cgQueries = num(s.cgQueries, 0);
		const cgStatsPath = (s.cgStatsPath ?? "").trim() || DEFAULT_CG_STATS_PATH;
		const usdPerM = num(s.usdPerMTokens, 3) || 3;
		const money = (tokens: number): number => (tokens * usdPerM) / 1e6;

		try {
			const v = this.view(a.id, s);
			const needRtk =
				v === "rtk" ||
				v === "total" ||
				v === "today" ||
				v === "todaytotal" ||
				v === "week" ||
				v === "month" ||
				v === "money";
			const needGfy = v === "graphify" || v === "total" || v === "money" || v === "gfytoday" || v === "todaytotal";
			const needCg = v === "codegraph" || v === "total" || v === "money" || v === "cgtoday" || v === "todaytotal";

			const r = needRtk ? await readRtk(cmd) : null;
			const g = needGfy ? await readGraphify({ perQuery, fallbackQueries: queries, statsPath, costPath }) : null;
			const c = needCg
				? await readCodegraph({ perQuery: cgPerQuery, fallbackQueries: cgQueries, statsPath: cgStatsPath })
				: null;

			await a.setImage(this.face(v, r, g, c, money));
			await a.setTitle(""); // the SVG carries all the text
		} catch {
			await a.setImage(renderKey({ tag: "ERR", value: "!", sub: "see logs", color: COLOR.error }));
		}
	}

	/** Build the SVG key face for the active readout. */
	private face(
		v: View,
		r: Awaited<ReturnType<typeof readRtk>> | null,
		g: Awaited<ReturnType<typeof readGraphify>> | null,
		c: Awaited<ReturnType<typeof readCodegraph>> | null,
		money: (tokens: number) => number,
	): string {
		const total = (r?.ok ? r.totalSaved : 0) + (g?.net ?? 0) + (c?.saved ?? 0);

		switch (v) {
			case "rtk":
				return r?.ok
					? renderKey({
							tag: "RTK",
							value: formatCompact(r.totalSaved),
							sub: r.avgPct != null ? `${r.avgPct}% saved` : "saved",
							color: COLOR.rtk,
						})
					: renderKey({ tag: "RTK", value: "—", sub: "run rtk gain", color: COLOR.error });

			case "graphify": {
				let value: string;
				let sub: string;
				if (g && g.queries > 0) {
					value = showSigned(g.net, "≈");
					const proj = g.projects > 1 ? ` · ${g.projects}p` : "";
					sub = (g.haveCost ? `net est · ${g.queries}q` : `est · ${g.queries}q`) + proj;
				} else if (g && g.haveCost) {
					// No query count yet -> show the real build cost honestly (it's a spend, not a saving).
					value = "−" + formatCompact(g.spent);
					const proj = g.projects > 1 ? ` · ${g.projects}p` : "";
					sub = `spent · ${g.runs} run${g.runs === 1 ? "" : "s"}${proj}`;
				} else {
					value = "~0";
					sub = "no queries yet";
				}
				return renderKey({ tag: "GRAPHIFY", value, sub, color: COLOR.graphify });
			}

			case "codegraph": {
				// Realized estimate that climbs with each lookup. CodeGraph is 100% local with no savings
				// ledger, so this is queries × tokens/query — a pure positive estimate, always marked ≈.
				if (c && c.queries > 0) {
					return renderKey({
						tag: "CODEGRAPH",
						value: "≈" + formatCompact(c.saved),
						sub: `est · ${c.queries}q`,
						color: COLOR.codegraph,
					});
				}
				return renderKey({ tag: "CODEGRAPH", value: "~0", sub: "no queries yet", color: COLOR.codegraph });
			}

			case "total":
				return renderKey({
					tag: "TOTAL",
					value: showSigned(total, "≈"),
					sub: r?.ok ? "measured+est" : "estimates only",
					color: COLOR.total,
				});

			case "today":
				return r?.ok
					? renderKey({ tag: "TODAY", value: formatCompact(r.today), sub: "saved today", color: COLOR.today })
					: renderKey({ tag: "TODAY", value: "—", sub: "run rtk gain", color: COLOR.error });

			case "gfytoday":
				// Today's Graphify queries × tokens/query — gross estimate (no per-day spend), always ≈.
				return g && g.todayQueries > 0
					? renderKey({
							tag: "GFY TODAY",
							value: "≈" + formatCompact(g.todaySaved),
							sub: `est · ${g.todayQueries}q`,
							color: COLOR.gfytoday,
						})
					: renderKey({ tag: "GFY TODAY", value: "~0", sub: "no queries today", color: COLOR.gfytoday });

			case "cgtoday":
				// Today's CodeGraph lookups × tokens/query — realized estimate, always ≈.
				return c && c.todayQueries > 0
					? renderKey({
							tag: "CG TODAY",
							value: "≈" + formatCompact(c.todaySaved),
							sub: `est · ${c.todayQueries}q`,
							color: COLOR.cgtoday,
						})
					: renderKey({ tag: "CG TODAY", value: "~0", sub: "no queries today", color: COLOR.cgtoday });

			case "todaytotal": {
				// RTK's measured today + Graphify/CodeGraph today estimates, so it's marked ≈.
				const todayAll = (r?.ok ? r.today : 0) + (g?.todaySaved ?? 0) + (c?.todaySaved ?? 0);
				return renderKey({
					tag: "TODAY ALL",
					value: showSigned(todayAll, "≈"),
					sub: r?.ok ? "measured+est" : "estimates only",
					color: COLOR.todaytotal,
				});
			}

			case "week":
				return r?.ok
					? renderKey({ tag: "WEEK", value: formatCompact(r.week), sub: "this week", color: COLOR.week })
					: renderKey({ tag: "WEEK", value: "—", sub: "run rtk gain", color: COLOR.error });

			case "month":
				return r?.ok
					? renderKey({ tag: "MONTH", value: formatCompact(r.month), sub: "this month", color: COLOR.month })
					: renderKey({ tag: "MONTH", value: "—", sub: "run rtk gain", color: COLOR.error });

			case "money":
				return renderKey({
					tag: "MONEY",
					value: showSignedMoney(money(total)),
					sub: r?.ok ? `today ${formatMoney(money(r.today))}` : "estimates only",
					color: COLOR.money,
				});
		}
	}
}

/** Coerce a setting that may arrive from the property inspector as a string. */
function num(v: unknown, fallback: number): number {
	const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
	return Number.isFinite(n) ? n : fallback;
}

/** Format with a leading minus for negatives; `prefix` (e.g. "≈") is added only when non-negative. */
function showSigned(n: number, prefix = ""): string {
	return n < 0 ? "−" + formatCompact(-n) : prefix + formatCompact(n);
}

/** Money variant: formatMoney already carries the sign, so only prefix the "≈" when non-negative. */
function showSignedMoney(usd: number): string {
	return usd < 0 ? formatMoney(usd) : "≈" + formatMoney(usd);
}
