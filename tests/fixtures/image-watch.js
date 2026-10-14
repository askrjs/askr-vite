import path from "node:path";

export function nextWatchBuild(watcher, timeout = 4_000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buildError;
    const finish = (error) => {
      clearTimeout(timer);
      watcher.off("event", onEvent);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = (event) => {
      events.push(event.code);
      if (event.code === "ERROR") buildError = event.error;
      else if (event.code === "END") finish(buildError);
    };
    const timer = setTimeout(
      () => finish(new Error(`No completed image watch rebuild; events: ${events.join(", ")}`)),
      timeout,
    );
    watcher.on("event", onEvent);
  });
}

export async function startImageWatcher(root, build, plugin) {
  return build({
    root,
    configFile: false,
    base: "/docs/",
    logLevel: "silent",
    plugins: [plugin],
    build: {
      lib: { entry: path.join(root, "src/main.ts"), formats: ["es"], fileName: "bundle" },
      minify: false,
      sourcemap: true,
      watch: { buildDelay: 20 },
      rollupOptions: {
        external: [/^@askrjs\//],
        output: { assetFileNames: "assets/[name]-[hash][extname]" },
      },
    },
  });
}
