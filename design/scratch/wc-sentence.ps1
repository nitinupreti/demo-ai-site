$s = 'Assessed size, turn/tool budgets, or "this will take too long" judgments never authorize silently substituting a smaller scope; the executing agent must not self-authorize reduced scope under any framing. If exhaustive execution seems infeasible, halt and disclose the specific blocker before proceeding, never after the fact.'
$wc = ($s -split '\s+' | Where-Object { $_ -ne '' }).Count
Write-Output "SENTENCE_WORDS=$wc"
