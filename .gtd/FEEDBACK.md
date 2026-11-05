
> @pmelab/gtd@64.1.2 test
> jiti scripts/test-states.main.ts

vite.config.ts (2:15) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'typescript' in vite.config.ts
   [38;5;246m╭[0m[38;5;246m─[0m[38;5;246m[[0m vite.config.ts:2:16 [38;5;246m][0m
   [38;5;246m│[0m
 [38;5;246m2 │[0m [38;5;249mi[0m[38;5;249mm[0m[38;5;249mp[0m[38;5;249mo[0m[38;5;249mr[0m[38;5;249mt[0m[38;5;249m [0m[38;5;249mt[0m[38;5;249ms[0m[38;5;249m [0m[38;5;249mf[0m[38;5;249mr[0m[38;5;249mo[0m[38;5;249mm[0m[38;5;249m [0m"typescript"
 [38;5;240m  │[0m                ──────┬─────  
 [38;5;240m  │[0m                      ╰─────── Module not found, treating it as an external dependency
[38;5;246m───╯[0m

vite.config.ts (3:29) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'vite-plus' in vite.config.ts
   [38;5;246m╭[0m[38;5;246m─[0m[38;5;246m[[0m vite.config.ts:3:30 [38;5;246m][0m
   [38;5;246m│[0m
 [38;5;246m3 │[0m [38;5;249mi[0m[38;5;249mm[0m[38;5;249mp[0m[38;5;249mo[0m[38;5;249mr[0m[38;5;249mt[0m[38;5;249m [0m[38;5;249m{[0m[38;5;249m [0m[38;5;249md[0m[38;5;249me[0m[38;5;249mf[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249me[0m[38;5;249mC[0m[38;5;249mo[0m[38;5;249mn[0m[38;5;249mf[0m[38;5;249mi[0m[38;5;249mg[0m[38;5;249m [0m[38;5;249m}[0m[38;5;249m [0m[38;5;249mf[0m[38;5;249mr[0m[38;5;249mo[0m[38;5;249mm[0m[38;5;249m [0m"vite-plus"
 [38;5;240m  │[0m                              ─────┬─────  
 [38;5;240m  │[0m                                   ╰─────── Module not found, treating it as an external dependency
[38;5;246m───╯[0m

failed to load config from /Users/pmelab/Workbench/gtd/wt/feat-gtd-565-gtd-ui-cannot-tick-a-box-in-prreview-s-p/vite.config.ts
[Vite+] resolve universal vite config error: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript' imported from /Users/pmelab/Workbench/gtd/wt/feat-gtd-565-gtd-ui-cannot-tick-a-box-in-prreview-s-p/vite.config.ts.timestamp-1793889074060-aed355a7546d28.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
    at packageResolve (node:internal/modules/esm/resolve:784:25)
    at moduleResolve (node:internal/modules/esm/resolve:873:18)
    at defaultResolve (node:internal/modules/esm/resolve:1006:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:705:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)
    at #resolve (node:internal/modules/esm/loader:687:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33) {
  code: 'ERR_MODULE_NOT_FOUND'
}
error: Failed to load task graph
* Failed to load task config file for package at /Users/pmelab/Workbench/gtd/wt/feat-gtd-565-gtd-ui-cannot-tick-a-box-in-prreview-s-p/
* Failed to resolve vite config: GenericFailure, Cannot find package 'typescript' imported from /Users/pmelab/Workbench/gtd/wt/feat-gtd-565-gtd-ui-cannot-tick-a-box-in-prreview-s-p/vite.config.ts.timestamp-1793889074060-aed355a7546d28.mjs

<!-- gtd check 1600695 -->
