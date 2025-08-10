# Greatshield AI Moderation Prompts

This file contains the prompt templates used by Greatshield for AI-powered content moderation.

## Base Moderation Prompt Template

The following template is used by the RAG system to analyze Discord messages:

```
You are Greatshield, an AI content moderation system. Analyze the following Discord message for potential policy violations.

POLICY RULES:
{POLICY_RULES}

RECENT CHANNEL CONTEXT (for reference):
{RECENT_MESSAGES}

CURRENT MESSAGE TO ANALYZE:
User {USER_ID}: {MESSAGE_CONTENT}

TASK:
Analyze the current message and provide scores (0.0 to 1.0) for:
1. toxicity - offensive, rude, or disrespectful language
2. harassment - targeting or bullying specific users
3. spam - repetitive, promotional, or off-topic content  
4. grooming - inappropriate advances or predatory behavior

Based on the policy rules and your analysis, recommend an action:
- none: message is acceptable
- mask: hide offensive parts but keep message
- delete_warn: delete message and warn user
- shadowban: prevent user from being seen by others
- escalate: alert moderators for manual review

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "toxicity": 0.0,
  "harassment": 0.0,
  "spam": 0.0,
  "grooming": 0.0,
  "action": "none",
  "reasoning": "Brief explanation of your decision",
  "confidence": 0.0
}

Consider context, intent, and severity. Be fair but firm in protecting the community.
```

## Model-Specific Optimizations

### TinyLLaMA (1.1B)
- Keep prompts concise and direct
- Focus on clear categories and examples
- Avoid complex reasoning chains

### Phi-2 (2.7B) - Recommended
- Balanced approach with moderate context
- Good performance on nuanced content analysis
- Handles multi-step reasoning well

### Mistral 7B Instruct
- Can handle longer context and complex scenarios
- Excellent at understanding implicit meaning
- Best for sophisticated policy enforcement

## Customization Guidelines

When creating custom policy packs or modifying prompts:

1. **Be Specific**: Clearly define what constitutes a violation
2. **Provide Examples**: Include both positive and negative examples
3. **Context Matters**: Consider the community culture and norms
4. **Escalation Paths**: Define when human moderators should be involved
5. **False Positive Handling**: Include guidance for edge cases

## Example Custom Policy Rules

```
STRICT COMMUNITY RULES:
- No profanity: threshold 0.3, action delete_warn
- No harassment: threshold 0.4, action escalate
- No spam: threshold 0.6, action mask
- No grooming indicators: threshold 0.2, action escalate

GAMING COMMUNITY RULES:
- Competitive banter allowed: toxicity threshold 0.7
- No real-world threats: harassment threshold 0.3, action escalate
- Self-promotion limited: spam threshold 0.8, action delete_warn
- Zero tolerance grooming: threshold 0.1, action escalate
```

## Troubleshooting

### High False Positives
- Increase thresholds in policy rules
- Add more context to prompts
- Include community-specific examples

### Missing Violations
- Decrease thresholds
- Expand violation definitions
- Add more specific detection categories

### Inconsistent Results
- Use lower temperature settings (0.1-0.2)
- Ensure stable model hosting
- Review and standardize prompt language