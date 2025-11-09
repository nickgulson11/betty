# Betty Bot - Production Deployment Guide

This guide walks you through deploying Betty Bot to production.

## Prerequisites

Before deploying to production, ensure you have:

- ✅ Completed all development phases
- ✅ Tested bet creation, acceptance, and settlement
- ✅ Verified cron job settlement works correctly
- ✅ Set up a production PostgreSQL database (Supabase recommended)
- ✅ Created Slack app with production workspace permissions
- ✅ Obtained Anthropic Claude API key

## Production Environment Setup

### 1. Choose a Hosting Provider

Betty Bot needs a server that can:
- Run Node.js 18+
- Stay online 24/7 (for cron job)
- Accept incoming HTTPS requests from Slack
- Support environment variables

**Recommended options:**
- **Railway** (easiest, auto-deploy from GitHub)
- **Render** (free tier available)
- **Heroku** (familiar, paid)
- **DigitalOcean App Platform**
- **AWS/GCP/Azure** (most flexible, more complex)

### 2. Set Up Production Environment Variables

Create a `.env` file on your production server with the following values:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-production-bot-token
SLACK_SIGNING_SECRET=your-production-signing-secret

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-your-production-api-key

# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://user:password@host.supabase.co:5432/postgres

# Server Configuration
NODE_ENV=production
PORT=3000

# Testing Mode - MUST BE FALSE IN PRODUCTION
TESTING_MODE=false
```

**IMPORTANT:**
- Never commit this `.env` file to git
- Use your hosting provider's environment variable settings instead of a file
- Ensure `TESTING_MODE=false` in production

### 3. Update Slack App Event Subscriptions

Once your production server is deployed:

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Select your Betty app
3. Navigate to **Event Subscriptions**
4. Update **Request URL** to your production URL:
   ```
   https://your-production-domain.com/slack/events
   ```
5. Verify the URL (Slack will send a challenge request)

### 4. Stop Local Development Servers

Once you've deployed to production:

**Stop ngrok:**
```bash
# Press Ctrl+C in your ngrok terminal
# Or if running in background:
killall ngrok
```

**Stop local Node server:**
```bash
# Press Ctrl+C in your npm terminal
# Or if running in background:
npm run stop  # (if you have this script)
# OR
killall node
```

**Important:** Your local development server and ngrok are only needed for testing. Once deployed to production, Slack will send events directly to your production server.

## Deployment Steps

### Option 1: Railway (Recommended for Beginners)

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Initialize Project**
   ```bash
   railway init
   ```

4. **Set Environment Variables**
   ```bash
   railway variables set SLACK_BOT_TOKEN=xoxb-...
   railway variables set SLACK_SIGNING_SECRET=...
   railway variables set ANTHROPIC_API_KEY=sk-ant-...
   railway variables set DATABASE_URL=postgresql://...
   railway variables set NODE_ENV=production
   railway variables set PORT=3000
   railway variables set TESTING_MODE=false
   ```

5. **Deploy**
   ```bash
   railway up
   ```

6. **Get Production URL**
   ```bash
   railway domain
   ```

7. Update Slack Event Subscriptions URL with Railway domain

### Option 2: Render

1. Push your code to GitHub
2. Create account at [Render](https://render.com)
3. Create new **Web Service**
4. Connect your GitHub repository
5. Configure:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
6. Add environment variables in Render dashboard
7. Deploy and copy the production URL
8. Update Slack Event Subscriptions URL

### Option 3: Heroku

1. **Install Heroku CLI**
   ```bash
   brew install heroku/brew/heroku
   ```

2. **Login and Create App**
   ```bash
   heroku login
   heroku create betty-bot-production
   ```

3. **Set Environment Variables**
   ```bash
   heroku config:set SLACK_BOT_TOKEN=xoxb-...
   heroku config:set SLACK_SIGNING_SECRET=...
   heroku config:set ANTHROPIC_API_KEY=sk-ant-...
   heroku config:set DATABASE_URL=postgresql://...
   heroku config:set NODE_ENV=production
   heroku config:set TESTING_MODE=false
   ```

4. **Deploy**
   ```bash
   git push heroku main
   ```

5. **Get URL**
   ```bash
   heroku domains
   ```

6. Update Slack Event Subscriptions URL

## Post-Deployment Checklist

After deploying, verify everything works:

- [ ] Production server is running and accessible
- [ ] Slack Event Subscriptions URL verified successfully
- [ ] Database connection working (check logs)
- [ ] Test creating a bet in Slack workspace
- [ ] Test accepting a bet with thumbs up reaction
- [ ] Test declining a bet with ❌ reaction
- [ ] Verify settlement cron job runs every 30 minutes (check logs)
- [ ] Test bet settlement by creating a bet for a completed game
- [ ] Confirm settlement messages post to channel (reply_broadcast)
- [ ] Verify TESTING_MODE is false (only opponent can accept bets)

## Monitoring and Logs

### View Logs

**Railway:**
```bash
railway logs
```

**Render:**
- View in dashboard under "Logs" tab

**Heroku:**
```bash
heroku logs --tail
```

### Key Log Messages to Monitor

- `⚡️ Betty Slack bot is running on port 3000` - Server started
- `✅ Database connected` - Database healthy
- `⏰ Settlement scheduler started` - Cron job initialized
- `⏰ Running bet settlement check...` - Cron job executing (every 30 min)
- `✅ Bet X settled successfully` - Successful settlement

### Error Monitoring

Watch for these errors:
- `❌ Error handling mention:` - Bet creation failed
- `❌ Error in settlement scheduler:` - Cron job failed
- `Failed to connect to database` - Database connection issue
- `Error parsing bet intent with Claude:` - Claude API issue

## Updating Production

When you need to deploy code changes:

**Railway:**
```bash
railway up
```

**Render:**
- Push to GitHub (auto-deploys if configured)
- Or trigger manual deploy in dashboard

**Heroku:**
```bash
git push heroku main
```

## Rollback (If Something Goes Wrong)

**Railway:**
```bash
railway rollback
```

**Render:**
- Use "Rollback" button in dashboard

**Heroku:**
```bash
heroku releases
heroku rollback v123  # Replace with version number
```

## Cost Estimates

**Hosting:**
- Railway: Free tier available, ~$5/month for basic usage
- Render: Free tier available (sleeps after inactivity)
- Heroku: ~$7/month (Eco dyno)

**Database:**
- Supabase: Free tier (500MB, 2GB bandwidth/month)

**Claude API:**
- ~$3 per 1M input tokens, ~$15 per 1M output tokens
- Estimated: <$5/month for moderate usage (50 bets/day)

**ESPN API:**
- Free (no authentication required)

**Total:** ~$5-15/month depending on usage

## Troubleshooting

### Slack Events Not Received

1. Check Event Subscriptions Request URL is correct
2. Verify URL is HTTPS (not HTTP)
3. Check server logs for incoming requests
4. Ensure server is running and accessible

### Database Connection Errors

1. Verify DATABASE_URL is correct
2. Check Supabase connection pooler is enabled
3. Ensure database allows connections from production IP
4. Check database credentials haven't expired

### Cron Job Not Running

1. Verify server is always online (not sleeping)
2. Check logs for settlement scheduler startup message
3. Ensure timezone is correct for your use case
4. Free tier hosts may pause servers (upgrade if needed)

### Settlement Messages Not Broadcasting

1. Verify `reply_broadcast: true` in settlementScheduler.ts
2. Check bot has permission to post in channel
3. Ensure thread_ts is valid

## Security Best Practices

- ✅ Never commit `.env` to git
- ✅ Use environment variables for all secrets
- ✅ Rotate API keys periodically
- ✅ Keep dependencies updated (`npm audit`)
- ✅ Set `TESTING_MODE=false` in production
- ✅ Monitor logs for unauthorized access attempts
- ✅ Use HTTPS only (enforced by hosting providers)

## Need Help?

If you encounter issues:
1. Check the logs first
2. Review this deployment guide
3. Verify all environment variables are set
4. Test locally with ngrok to isolate the issue
5. Check Slack API documentation
6. Consult your hosting provider's support

## Next Steps

Once deployed and verified:
1. Monitor logs for first 24 hours
2. Test with real bets
3. Invite team members to Slack workspace
4. Enjoy automated NBA betting! 🏀
