import {
	action,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
	type KeyDownEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";

import { readRtk, readGraphify, formatCompact } from "./sources";
import { renderKey } from "./render";

type Mode = "cycle" | "rtk" | "graphify" | "combined";

type Settings = {
	mode?: Mode;
	rtkCommand?: string;
	pollSeconds?: number | string;
	gfyPerQuery?: number | string;
	gfyQueries?: number | string;
	gfyStatsPath?: string;
	gfyCostPath?: string;
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

const ORDER = ["rtk", "graphify", "combined"] as const;
type View = (typeof ORDER)[number];

const COLOR = { rtk: "#34d399", graphify: "#fbbf24", combined: "#60a5fa", error: "#f87171" };

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
		return m === "cycle" ? ORDER[this.cycle.get(id) ?? 0] : m;
	}

	private async refresh(a: KeyLike, s: Settings): Promise<void> {
		const cmd = (s.rtkCommand ?? "").trim() || "rtk gain";
		const perQuery = num(s.gfyPerQuery, 121_300) || 121_300;
		const queries = num(s.gfyQueries, 0);
		const statsPath = (s.gfyStatsPath ?? "").trim() || undefined;
		const costPath = (s.gfyCostPath ?? "").trim() || undefined;

		try {
			const v = this.view(a.id, s);

			if (v === "rtk") {
				const r = await readRtk(cmd);
				await a.setImage(
					r.ok
						? renderKey({
								tag: "RTK",
								value: formatCompact(r.saved),
								sub: r.percent != null ? `${r.percent}% saved` : "saved",
								color: COLOR.rtk,
							})
						: renderKey({ tag: "RTK", value: "—", sub: "run rtk gain", color: COLOR.error }),
				);
			} else if (v === "graphify") {
				const g = await readGraphify({ perQuery, fallbackQueries: queries, statsPath, costPath });
				let value: string;
				let sub: string;
				if (g.queries > 0) {
					value = showSigned(g.net, "≈");
					sub = g.haveCost ? `net est · ${g.queries}q` : `est · ${g.queries}q`;
				} else if (g.haveCost) {
					// No query count yet -> show the real build cost honestly (it's a spend, not a saving).
					value = "−" + formatCompact(g.spent);
					sub = `spent · ${g.runs} run${g.runs === 1 ? "" : "s"}`;
				} else {
					value = "~0";
					sub = "set queries";
				}
				await a.setImage(renderKey({ tag: "GRAPHIFY", value, sub, color: COLOR.graphify }));
			} else {
				const r = await readRtk(cmd);
				const g = await readGraphify({ perQuery, fallbackQueries: queries, statsPath, costPath });
				const total = (r.ok ? r.saved : 0) + g.net; // RTK measured + Graphify (est saved − real cost)
				await a.setImage(
					renderKey({
						tag: "TOTAL",
						value: showSigned(total, "≈"),
						sub: r.ok ? "measured+est" : "graphify only",
						color: COLOR.combined,
					}),
				);
			}

			await a.setTitle(""); // the SVG carries all the text
		} catch {
			await a.setImage(renderKey({ tag: "ERR", value: "!", sub: "see logs", color: COLOR.error }));
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
