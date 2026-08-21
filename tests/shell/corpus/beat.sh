# shellcheck disable=SC2034,SC1003
unset gtd_kind gtd_content gtd_idle gtd_session_id gtd_session_resume gtd_model gtd_system gtd_validate gtd_log gtd_state gtd_actor gtd_label gtd_memory gtd_file gtd_mode gtd_edges gtd_changes gtd_next_pattern gtd_next_target gtd_next_action gtd_cost gtd_costByModel
gtd_kind='prompt'
gtd_content='fix the failing build'
gtd_session_id='11111111-1111-1111-1111-111111111111'
gtd_session_resume=true
gtd_model='smart'
gtd_validate='gtd validate qa .gtd/TODO.md'
gtd_log='gtd(agent): build.fixing'
gtd_state='build.fixing'
gtd_actor='agent'
gtd_label='Fix Build'
gtd_memory='build.fixing#abc1234'
gtd_file='.gtd/TODO.md'
gtd_mode='qa'
gtd_edges='A	build.review.deciding	approved
R	build.fixing	'
gtd_changes='M	.gtd/TODO.md	A
A	src/foo.ts	'
gtd_next_pattern='A'
gtd_next_target='build.review.deciding'
gtd_next_action='advance'
gtd_cost='0.47'
gtd_costByModel='smart	0.42
cheap	0.05'
