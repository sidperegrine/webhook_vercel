# How to Deploy to Vercel - Step by Step Guide

## What is Vercel?
Vercel is a cloud platform that makes it super easy to deploy web applications. It's free for personal projects and handles scaling automatically.

## Prerequisites

1. **GitHub Account** (free) - https://github.com
2. **Vercel Account** (free) - https://vercel.com
3. **MongoDB Atlas Account** (free) - https://www.mongodb.com/cloud/atlas

---

## Part 1: Set Up MongoDB Atlas (Cloud Database)

### Step 1: Create MongoDB Atlas Account
1. Go to https://www.mongodb.com/cloud/atlas
2. Click "Try Free" and sign up
3. Choose the **FREE tier** (M0)

### Step 2: Create a Cluster
1. After login, click "Build a Database"
2. Choose **FREE** tier (M0 Sandbox)
3. Select a cloud provider (AWS recommended)
4. Choose a region closest to you
5. Click "Create Cluster" (takes 3-5 minutes)

### Step 3: Create Database User
1. Go to "Database Access" in left sidebar
2. Click "Add New Database User"
3. Choose "Password" authentication
4. Username: `webhook_user` (or anything you want)
5. Password: Generate a strong password (save it!)
6. User Privileges: Select "Read and write to any database"
7. Click "Add User"

### Step 4: Allow Network Access
1. Go to "Network Access" in left sidebar
2. Click "Add IP Address"
3. Click "Allow Access from Anywhere" (0.0.0.0/0)
   - ⚠️ For production, you'd restrict this, but for now this is fine
4. Click "Confirm"

### Step 5: Get Connection String
1. Go to "Database" in left sidebar
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Select "Node.js" as driver
5. Copy the connection string - it looks like:
   ```
   mongodb+srv://webhook_user:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<password>` with your actual password
7. Add database name at the end:
   ```
   mongodb+srv://webhook_user:yourpassword@cluster0.xxxxx.mongodb.net/webhook_db?retryWrites=true&w=majority
   ```
8. **Save this connection string** - you'll need it for Vercel!

---

## Part 2: Push Code to GitHub

### Step 1: Create a GitHub Repository
1. Go to https://github.com
2. Click the "+" icon → "New repository"
3. Name: `webhook-server` (or whatever you like)
4. Choose "Public" or "Private"
5. **Don't** initialize with README (we already have files)
6. Click "Create repository"

### Step 2: Upload Your Code

**Option A: Using GitHub Web Interface (Easiest)**
1. On your new repo page, click "uploading an existing file"
2. Drag and drop all these files:
   - `webhook-server.js`
   - `package.json`
   - `vercel.json`
   - `.gitignore`
   - `README.md`
   - `EXAMPLES.md`
   - (don't upload `.env.example` or `test-webhook.js`)
3. Click "Commit changes"

**Option B: Using Git Command Line**
```bash
# In your project folder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/webhook-server.git
git push -u origin main
```

---

## Part 3: Deploy to Vercel

### Step 1: Sign Up for Vercel
1. Go to https://vercel.com
2. Click "Sign Up"
3. Choose "Continue with GitHub"
4. Authorize Vercel to access your GitHub

### Step 2: Import Your Project
1. On Vercel dashboard, click "Add New..." → "Project"
2. Find your `webhook-server` repository
3. Click "Import"

### Step 3: Configure Project
1. **Framework Preset:** Select "Other"
2. **Root Directory:** Leave as `./`
3. **Build Command:** Leave empty or use `npm install`
4. **Output Directory:** Leave empty
5. **Install Command:** `npm install`

### Step 4: Add Environment Variables
This is **CRITICAL** - your MongoDB connection!

1. Click "Environment Variables"
2. Add the following:

   **Name:** `MONGODB_URI`
   **Value:** Your MongoDB Atlas connection string from Part 1, Step 5
   ```
   mongodb+srv://webhook_user:yourpassword@cluster0.xxxxx.mongodb.net/webhook_db?retryWrites=true&w=majority
   ```

   **Name:** `NODE_ENV`
   **Value:** `production`

3. Click "Add" for each variable

### Step 5: Deploy!
1. Click "Deploy"
2. Wait 1-2 minutes for deployment
3. You'll see "Congratulations! 🎉"
4. Click "Visit" to see your live site

### Step 6: Get Your Webhook URL
Your webhook will be live at:
```
https://your-project-name.vercel.app/webhook
```

For example:
```
https://webhook-server-abc123.vercel.app/webhook
```

---

## Part 4: Test Your Live Webhook

### Test with curl:
```bash
curl -X POST https://your-project-name.vercel.app/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "test", "message": "Hello from Vercel!"}'
```

### Test in Browser:
Visit:
```
https://your-project-name.vercel.app/health
```

### View Webhooks:
```
https://your-project-name.vercel.app/webhooks
```

---

## Common Issues & Solutions

### ❌ "Cannot connect to MongoDB"
**Solution:** 
- Check your MONGODB_URI in Vercel environment variables
- Make sure you replaced `<password>` with your actual password
- Verify "Network Access" allows 0.0.0.0/0 in MongoDB Atlas

### ❌ "Application Error"
**Solution:**
- Check the "Logs" tab in Vercel
- Make sure all files are uploaded to GitHub
- Verify `vercel.json` is present

### ❌ "502 Bad Gateway"
**Solution:**
- Wait a few minutes (cold start)
- Check MongoDB Atlas is running
- Redeploy from Vercel dashboard

### ❌ Webhook works but data not saving
**Solution:**
- Check MongoDB Atlas user has "Read and write" permissions
- Verify connection string has database name: `/webhook_db?`
- Check Vercel logs for errors

---

## Important Notes for Vercel

### ⚠️ Serverless Functions
Vercel uses serverless functions, which means:
- Your server starts on-demand (may have cold starts)
- First request might be slow (1-2 seconds)
- Subsequent requests are fast

### ⚠️ MongoDB Connection
- Connection is created per request
- MongoDB Atlas handles connection pooling
- This is normal for serverless architecture

### 💡 Free Tier Limits
Vercel free tier includes:
- 100 GB bandwidth per month
- 100 hours of serverless function execution
- Unlimited requests (fair use)

MongoDB Atlas free tier includes:
- 512 MB storage
- Shared CPU
- More than enough for testing and small projects

---

## Update Your Webhook

To update your deployed webhook:

1. Make changes to your code locally
2. Push to GitHub:
   ```bash
   git add .
   git commit -m "Updated webhook handler"
   git push
   ```
3. Vercel automatically redeploys! ✨

---

## Monitoring

### View Logs in Vercel:
1. Go to your project in Vercel dashboard
2. Click "Logs" tab
3. See real-time webhook requests

### View Data in MongoDB:
1. Go to MongoDB Atlas
2. Click "Browse Collections"
3. Select `webhook_db` database
4. See all your webhook data

---

## Next Steps

Once deployed, you can:
1. Use your webhook URL in external services (Stripe, GitHub, etc.)
2. Build additional features on top of the stored data
3. Add authentication for security
4. Create a dashboard to visualize webhook data

---

## Quick Reference

**Your Webhook URL:**
```
https://your-project-name.vercel.app/webhook
```

**View All Webhooks:**
```
https://your-project-name.vercel.app/webhooks
```

**Health Check:**
```
https://your-project-name.vercel.app/health
```

---

## Need Help?

- Vercel Docs: https://vercel.com/docs
- MongoDB Atlas Docs: https://docs.atlas.mongodb.com
- Vercel Community: https://github.com/vercel/vercel/discussions
