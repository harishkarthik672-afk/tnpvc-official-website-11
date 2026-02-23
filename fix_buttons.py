import re

with open('about.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove CEO story button
content = re.sub(
    r'\s*<button class="team-story-btn btn-zoho" data-story-person="ceo"[^>]*>READ\s*\n\s*STORY</button>',
    '',
    content
)

# Check if karthik button still exists (should already be removed)
if 'data-story-person="karthik"' in content:
    content = re.sub(
        r'\s*<button class="team-story-btn btn-zoho" data-story-person="karthik"[^>]*>READ\s*\n\s*STORY</button>',
        '',
        content
    )

with open('about.html', 'w', encoding='utf-8') as f:
    f.write(content)

remaining = content.count('team-story-btn')
print(f'Done. Remaining team-story-btn count: {remaining}')
