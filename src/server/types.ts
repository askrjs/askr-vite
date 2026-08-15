/** Options for {@link askrServer}. */
export interface AskrServerOptions {
  /** Path to the server entry module, resolved relative to the Vite root. */
  entry: string;
  /** Named export on `entry` providing the `ServerApp`. Defaults to `"app"`, falling back to the default export. */
  exportName?: string;
  /** Path to the HTML document template, resolved relative to the Vite root. Defaults to `"index.html"`. */
  indexHtml?: string;
}
