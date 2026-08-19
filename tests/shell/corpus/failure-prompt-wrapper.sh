gtd_validate_status=0
gtd_validate_out="$( {
gtd check qa '.gtd/TODO.md'
} 2>&1 )" || gtd_validate_status=$?
if [ "$gtd_validate_status" -ne 0 ]; then
  printf '%s\n\n%s\n' 'Fix the following steering-file findings' "$gtd_validate_out"
  exit "$gtd_validate_status"
fi
