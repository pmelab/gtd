export default {
  paths: ["tests/integration/features/"],
  import: ["tests/integration/support/**/*.ts"],
  loader: ["./tests/integration/support/md-loader.mjs"],
  format: ["summary"],
  parallel: 4,
  tags: "not @skip",
}
