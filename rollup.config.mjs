import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const sdPlugin = "com.tokensaver.dashboard.sdPlugin";

/** @type {import("rollup").RollupOptions} */
export default {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: true,
	},
	// Node built-ins stay external; the Stream Deck Node runtime provides them.
	external: [/^node:/],
	plugins: [
		typescript({ tsconfig: "./tsconfig.json", sourceMap: true }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
	],
};
