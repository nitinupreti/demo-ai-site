$csrf = "eyJleHAiOjE3ODkxNDYwMzMsImlhdCI6MTc4OTE0NTQzM30.DoJI29NRlyF45WUofeEsK3sKISq0fNMQkQ1hwpl-h2Y"
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

# 1) Strip the embedded <blockquote> from the three section bodies (keep the rest of the rich text).
Post-Form "$base/section1body" @{
    "text" = '<p>Most fast-growing companies slow down as they scale because they add the wrong things: specialized tools that create silos, meetings to coordinate between those silos, and more processes to manage the complexity they''ve created. Cursor did the opposite.</p><p>When your AI code editor is changing how millions of developers work, every internal meeting about "process" is time not spent shipping. Every tool that requires context-switching is cognitive overhead your builders can''t afford. Cursor''s founders didn''t want their builders to become managers of work.</p><p>They started with Notion because it could grow with them and give everyone AI tools to avoid busywork. Over time, Notion has evolved into a lean operating system-a single space where all knowledge lives and work is done.</p>'
    "textIsRich" = "true"
}

Post-Form "$base/section3body" @{
    "text" = "<p>Fast-moving teams don't have time to dig for information, but most knowledge management tools weren't built for the velocity or possibility of AI.</p><p>Cursor gets this. They know that to unlock AI's potential, they needed a system that can capture everything happening at the company then make that knowledge easily accessible. Notion AI is that connective tissue-it brings together everything across their Notion workspace and all the tools like Slack that are connected to it to surface what their people need:</p><ul><li>Onboarding without friction: Notion AI serves as an onboarding buddy for new hires, surfacing relevant documents and context they didn't even know existed. No need to overwhelm teammates with questions or schedule catch-up meetings.</li><li>Search that saves hours: Using Enterprise Search, teams get immediate answers from Notion AI instead of hunting through docs and messages. With all organizational knowledge centralized, hard to reach information no longer slows them down.</li><li>Real-time updates, no standups required: Anyone can stay current on project progress by asking Notion AI, which surfaces related work and dependencies across teams that individuals might never have discovered on their own.</li></ul><p>With Notion AI built into where Cursor teams work and collaborate, the friction between knowing and doing dissolve. It connects dots across their workspace + connected apps, delivering rich insights and context right where work flows and decisions happen.</p>"
    "textIsRich" = "true"
}

Post-Form "$base/section4body" @{
    "text" = "<p>Where most companies accumulate tools that slow them down, Cursor consolidated to stay fast. Instead of buying a docs editor, an AI note-taking app, specialized knowledge bases, project management software, and enterprise search tools to stitch them all together, they get it all in one connected AI workspace.</p><p>This consolidation delivers real savings: Cursor estimates their current setup would have cost 5x more if assembled from individual point solutions. But the real win isn't financial-it's that everyone can actually find what they need without jumping between five different apps. With a leaner approach to how their teams operate, everyone avoids the context-switching that kills momentum and gains clarity often elusive at high-growth companies.</p><p>For a company building the future of code, their tools had to match their philosophy: simple, accessible, and smart enough to handle the boring stuff. As they continue to scale, Cursor recently moved onto Notion's Enterprise plan for the advanced controls, security, and dedicated support they need. Cursor doesn't just move fast on Notion-they stay aligned, stay focused, and keep building what matters most.</p>"
    "textIsRich" = "true"
}

# 2) Author 3 real testimonial component instances, ordered right after their section body.
Post-Form $base @{
    "quote1/jcr:primaryType" = "nt:unstructured"
    "quote1/sling:resourceType" = "demo-ai-site/components/testimonial"
    "quote1/quote" = "It's really important for the people that are building to have a lot of time to build, and not be stuck in tons of meetings or just work about work, says Cursor CEO and co-founder Michael Truell."
    "quote1/attributionName" = "Michael Truell"
    "quote1/attributionRole" = "Co-founder & CEO, Cursor"
    "quote1:order" = "after section1body"
}

Post-Form $base @{
    "quote2/jcr:primaryType" = "nt:unstructured"
    "quote2/sling:resourceType" = "demo-ai-site/components/testimonial"
    "quote2/quote" = "Keeping people in the loop as we've grown so fast is really difficult, but Notion AI helps everyone get the latest updates and context of what's going on across the company instantly."
    "quote2/attributionName" = "Michael Truell"
    "quote2/attributionRole" = "Co-founder & CEO, Cursor"
    "quote2:order" = "after section3body"
}

Post-Form $base @{
    "quote3/jcr:primaryType" = "nt:unstructured"
    "quote3/sling:resourceType" = "demo-ai-site/components/testimonial"
    "quote3/quote" = "We're moving away from a world where communication is siloed towards one where everything's accessible, and people up and down the org chart can contribute. Notion helps you do that in a low-overhead way."
    "quote3/attributionName" = "Michael Truell"
    "quote3/attributionRole" = "Co-founder & CEO, Cursor"
    "quote3:order" = "after section4body"
}
