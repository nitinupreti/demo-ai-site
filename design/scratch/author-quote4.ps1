$csrf = "eyJleHAiOjE3ODkxNDY5MDksImlhdCI6MTc4OTE0NjMwOX0.EIZDecJFdTMNwpUSl3N23vH7V91US3ejZKzGg_yoROU"
$authHeader = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:admin')))"
$headers = @{ Authorization = $authHeader; "CSRF-Token" = $csrf; Referer = "http://localhost:4506/" }
$base = "http://localhost:4506/content/demo-ai-site/us/en/customers/cursor/jcr:content/root/container/container"

function Post-Form($path, $form) {
    try {
        $r = Invoke-WebRequest -Uri $path -Method Post -Headers $script:headers -Body $form -UseBasicParsing
        Write-Output "$path -> $($r.StatusCode)"
    } catch {
        Write-Output "$path FAILED: $($_.Exception.Message)"
    }
}

Post-Form "$base/section2body" @{
    "text" = '<p>While Cursor''s rapid growth has captured headlines over the past few years, the majority of their first 100 employees are foundational hires made just in the last year. This created a pivotal moment in their growth. They needed to establish shared ways of working focused on actual workflows rather than purchasing point solutions and specialized tools for every function. "We were able to start with a default wiki," explains Michael, "and have each team build out their own business processes into things like databases."</p><p>This organic approach is core to Cursor''s unique philosophy for scaling a company-instead of standardizing processes, they standardized the foundation and let each team build and refine exactly what they need in their Notion workspace:</p><ul><li>Engineering and research maintain connected roadmaps and project trackers through databases that give leadership visibility while letting individual contributors focus on deep work-eliminating the need for standup meetings and the endless "when will this ship?" pings in Slack.</li><li>Design and product manage their entire development workflow from initial concepts to launch planning in one place, with the ability to directly embed anything from code to mockups to other apps like a Loom video to explain or a Miro board to ideate.</li><li>Sales and customer success reps like Jonathan Braude describe Notion as "the only tool that can keep up with the pace of change" at the company. It gives them a place to develop playbooks and lightweight systems they can iterate on as their teams grow, capturing insights from every customer interaction that the rest of the company can access-all without having to log into a separate CRM.</li></ul><p>What emerged wasn''t just efficiency but transparency by design. When teams build custom workflows on shared infrastructure, customization creates visibility rather than isolation. Each team''s specialized systems become windows into their work rather than walls around it.</p>'
    "textIsRich" = "true"
}

Post-Form $base @{
    "quote4/jcr:primaryType" = "nt:unstructured"
    "quote4/sling:resourceType" = "demo-ai-site/components/testimonial"
    "quote4/quote" = "I honestly can't imagine running a design team without Notion. It's our everything-but-code layer, we use it for project planning, design specs, research, to-dos. We have databases for just about everything."
    "quote4/attributionName" = "Ryo Lu"
    "quote4/attributionRole" = "Head of Design, Cursor"
    "quote4:order" = "after section2body"
}
