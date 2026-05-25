.result.content[0].text | fromjson | .bitable_updates[] | "  • [\(.status)]  \(.title)  (\(.updated_at_human))"
