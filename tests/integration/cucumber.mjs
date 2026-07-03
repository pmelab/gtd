export default {
  paths: ["tests/integration/features/"],
  import: ["tests/integration/support/**/*.ts"],
  requireModule: ["tsx"],
  loader: ["./tests/integration/support/md-loader.mjs"],
  format: ["progress"],
  parallel: 4,
  tags: "not @skip",
}
