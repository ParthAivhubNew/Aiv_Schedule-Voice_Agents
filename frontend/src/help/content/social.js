const p = (text) => ({ type: "paragraph", text });

export const socialDoc = {
  id: "social",
  path: "/help/social",
  title: "Social",
  summary: "Plan posts in a chat, check them on a calendar, approve them, and publish to LinkedIn, X, Facebook, Instagram, Threads and Reddit.",
  sections: [
    {
      id: "what-social-is-for",
      heading: "What Social is for",
      blocks: [
        p("Social is the app where you plan, write, approve and publish posts. You tell the “AI Assistant” what you want to post about and when. It proposes an outline. You confirm the outline, and then the captions and pictures are written. Every post waits for your approval before it goes out."),
        p("Social can post to six networks: LinkedIn, X, Facebook, Instagram, Threads and Reddit. Posts go out at their set time even when you have closed the browser."),
        p("The menu on the left has these pages."),
        {
          type: "table",
          headers: ["Menu item", "What it is for"],
          rows: [
            ["AI Assistant", "Ask in plain words. It reads your posts, results and accounts. It plans, rewrites, moves and removes posts for you to confirm."],
            ["Post calendar", "A month view of every post, with its status. Open a day to see its posts."],
            ["Posts to approve", "Posts waiting for your yes. Edit a post, approve it, or reject it."],
            ["Results & ideas", "Three pages: “Post results”, “Audience & ideas” and “Mentions”."],
            ["Library", "Two pages: “Pictures & videos” and “Import posts”."],
            ["Workflows", "Do something automatically when a post goes live or something else happens. See the Workflows guide."],
            ["Brand look", "Your logo, colours, what your business does and how your posts sound."],
            ["Social accounts", "Connect your networks. Test mode and link tracking are here too."],
          ],
        },
        p("The plan and credits for Social are under “Plan & credits”, opened from the credits at the bottom of the left menu or from “Manage plan” on the home screen. The Account and billing guide explains plans."),
      ],
    },
    {
      id: "before-you-start",
      heading: "Before you start",
      blocks: [
        {
          type: "steps",
          items: [
            "Open Social from the home screen. If your company has no Social plan yet, pages show “Choose a plan or buy a top-up to unlock Social.” Pick a plan under “Plan & credits”.",
            "Open “Theme” and fill in what your business does. Posts are written from this, so a blank profile gives generic posts.",
            "Open “Accounts” and connect at least one network.",
            "Open “Post approve” and, under the heading, press “Add approvers” if you want approval emails sent to someone.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Try it without posting",
          text: "Switch on “Test mode” under Accounts first. You can run the whole flow, from the outline to a published post, and nothing is sent to any network.",
        },
      ],
    },
    {
      id: "connecting-accounts",
      heading: "Connecting accounts",
      blocks: [
        p("Open “Accounts”. Under “Posting accounts” there is one card per network. Each card shows one of these lines."),
        {
          type: "table",
          headers: ["Card shows", "Meaning"],
          rows: [
            ["Ready to connect", "The network can be connected now. Press “Connect” and the network's name, for example “Connect LinkedIn”."],
            ["App not set up", "Connecting for this network is not switched on for your company yet. Contact support from the Support panel."],
            ["1 connected", "At least one account is live. The number is how many."],
            ["Needs reconnect", "An account was connected but its login no longer works. Press “Reconnect”."],
          ],
        },
        p("Press “Connect”. A small window opens on the network's own page, where you sign in and allow access. You can add more than one account for a network with “Add account”. Each account shows its status (“Live”, “Needs reconnect” or “Error”), its follower count when the network reports it, and a plain-words reason if it failed. “Disconnect” removes an account."),
        {
          type: "callout",
          tone: "note",
          title: "Character and picture limits",
          text: "Each network has its own limit. The most text: X 280 characters, Threads 500, Instagram 2,200, LinkedIn 3,000, Facebook 63,206, Reddit 40,000. The most pictures or videos in one post: X 4, Instagram 10, Threads 20, Facebook 10, LinkedIn 9, Reddit 20. Social checks these before it publishes.",
        },
      ],
    },
    {
      id: "planning-in-the-chat",
      heading: "Planning posts in the chat",
      blocks: [
        p("Open “AI Assistant” in the menu, or press the “AI Assistant” button at the top of any other page. The panel then sits beside the page. Say what you want in your own words, for example “Plan 3 posts for next week”, or paste a link or some text to write from."),
        p("The assistant can also answer questions. Examples from its suggestion list: “What is scheduled to go out?”, “How did my posts do this month?”, “Are my accounts connected?”, “How many credits do I have left?” and “What should I post about?”."),
        {
          type: "steps",
          items: [
            "Ask for the posts: the topic, the networks and the dates.",
            "The assistant answers with an outline card. It says how many new posts, for which networks and on which days. Nothing is on the calendar yet.",
            "Ask for a change if you want one, for example a different day or a different network. A new outline replaces the old one.",
            "Press “Write these posts” on the card. The posts are added to the calendar and the writing starts.",
            "Captions and pictures are written a few at a time. A progress bar shows the place in the queue and the time left. You can leave the page and writing carries on.",
            "Each finished post waits in “Post approve”.",
          ],
        },
        p("If a request is very large, the outline may cover only the first batch. The confirmation says so: ask again for the rest. A post that the AI could not finish shows “AI could not finish this post” with a “Retry” button."),
        p("If your Social credits run out part-way, a red bar says “AI writing paused.” It tells you how many posts are waiting and that nothing was charged for them. Press “Continue where it stopped” after you top up, or “Start new”."),
        p("The assistant never publishes. It also has a “Write a draft” helper: it shows wording under its answer without saving it, so you can see the tone before you plan."),
      ],
    },
    {
      id: "the-post-calendar",
      heading: "The post calendar and statuses",
      blocks: [
        p("“Post calendar” shows one month at a time. Use the arrows to move between months. Each post shows its network, its time and its status. Times are in your account time zone, shown under the month name. Three buttons sit above the grid: “Brand voice” (how your posts should sound), “Theme”, and “Schedule” (post right now, once, or on a repeating schedule)."),
        p("Click a day to pin it, and double-click to see every post on that day. A pinned day is where the assistant puts new posts when you do not give a date. Click a pinned day again to unpin it. On a phone, tap a day to see its posts under the month."),
        {
          type: "table",
          headers: ["Status on screen", "What it means", "What you do"],
          rows: [
            ["Waiting", "A draft. It needs your approval, or the AI is still writing it.", "Open it in “Post approve” and approve it."],
            ["Approved", "You approved it. It goes out at its time.", "Nothing. You can still edit it until it starts publishing."],
            ["Scheduled", "Approved and set for a later time.", "Nothing."],
            ["Publishing…", "It is being sent to the network now. It is locked while this happens.", "Wait a moment."],
            ["Posted", "It is live. “View on” the network's name opens it.", "Check “Post results” later."],
            ["Failed", "No network took it. The reason is shown on the post.", "See the next section."],
            ["Rejected", "An approver rejected it. Their note is shown: “Rejected by the approver.”", "Edit it and approve it again, or delete it."],
            ["Approval missed", "Its time passed and nobody approved it. It does not go out late by itself.", "Move it to a new time and approve it."],
          ],
        },
        p("A post waiting for approval becomes “Approval missed” when its time is more than 10 minutes past. A post set to go out right now waits up to a day."),
        p("A post that was changed by hand shows a “Changed by hand” mark. Chat requests that change many posts leave it alone."),
      ],
    },
    {
      id: "approvals",
      heading: "Approving posts",
      blocks: [
        p("Open “Post approve”. The list is filtered with four buttons: “Waiting”, “Approved”, “Posted” and “All”. The line at the top says how many posts need you. A number also shows next to “Post approve” in the menu."),
        p("Open a post to read it. You can edit the caption, change or redraw the picture, add your own picture, add a video, and set the time. “Earlier versions of this post” lists the last 10 versions, each marked “Original”, “Edited by you”, “Written by AI”, “Restored” or “Updated”, so you can go back."),
        p("Then press “Approve & schedule” (or “Approve & post now” when the time has already passed). The toast says “Approved. Goes live” with the day and time. When several drafts are ready, “Approve all” followed by the number approves them in one go."),
        {
          type: "callout",
          tone: "warning",
          title: "Nothing goes out without a yes",
          text: "Every post needs approval before it is published. The only exceptions are posts you chose to approve yourself in an import (see the Library section). Social never publishes a post you have not approved.",
        },
        p("The line under the heading shows who gets the approval emails. “Add approvers” (or “Change”) takes email addresses separated by commas. “Send again” emails the approvers about every post still waiting. If an email could not be sent, the line says “Approval email not sent to” followed by the address and the reason. With no approver emails, the line says “Approval emails are off: no approver emails set. Approve posts here instead.”"),
        p("An approver who rejects a post can leave a note. Over time, the “Brand voice” panel learns from how your team edits AI drafts, which posts did best and why approvers rejected posts. It refreshes weekly."),
      ],
    },
    {
      id: "failed-posts",
      heading: "When a post fails",
      blocks: [
        p("A post is marked “Failed” when no network accepted it. The reason is shown on the post, for example the network's own message."),
        {
          type: "table",
          headers: ["Kind of failure", "What Social does", "What you do"],
          rows: [
            ["The network was busy or could not be reached", "It tries again by itself, at least three times, waiting longer each time. It never tries again if any network already took the post, so a post cannot go out twice.", "Wait. If it still fails, press “Retry”."],
            ["The login no longer works", "It waits for you.", "Open “Accounts”, press “Reconnect” on that account, then retry."],
            ["The network refused the post", "It waits for you.", "Read the reason, change the post, and approve it again."],
          ],
        },
        p("When a scheduled post fails you get an in-app note, and an email if you chose “A scheduled post could not be published” in your profile notifications. The email says “Reconnect the account under Accounts, then retry” for a login problem."),
      ],
    },
    {
      id: "library-and-import",
      heading: "The library and importing posts",
      blocks: [
        p("“Library” has two pages."),
        p("“Pictures & videos” holds your saved pictures and videos, ready to use in posts. You can also make a short video with AI there (“Make a video with AI”). It uses Social credits."),
        p("“Import posts” adds many posts at once from a .csv or .xlsx file, up to 500 rows and 5 MB. Press “Download the template” to get the right columns. Only “channels” and either “text” or “topic” are needed."),
        {
          type: "table",
          headers: ["Column", "What goes in it"],
          rows: [
            ["date", "The publish date, day first, for example 03/11/2026 or 2026-11-03."],
            ["time", "For example 09:30 or 9:30 PM, in your account time zone. Empty means 09:00."],
            ["channels", "One or more of linkedin, x, facebook, instagram, threads, reddit. A row with several channels becomes one post per channel."],
            ["text", "The post. Leave it empty and fill “topic” to have the AI write it."],
            ["topic", "What the AI should write about. It costs 1 post credit each, as the page says."],
            ["title", "The headline. Needed for Reddit, where it is the post title."],
            ["media", "Links to pictures or videos, separated by commas. They are kept in your library."],
            ["first comment", "Posted under the post right after it goes live."],
            ["alt text", "Describes the first picture for screen readers."],
            ["subreddit", "For Reddit rows: the community to post in."],
          ],
        },
        p("The page checks every row first. Nothing is saved until you press “Import” and the number of posts. Rows with problems are listed in red as “Not imported”, with the reason, and are left out. Tick “Approve them now” if you want posts with text to go out at their time without another check. Posts the AI writes always wait for approval."),
      ],
    },
    {
      id: "mentions",
      heading: "Mentions",
      blocks: [
        p("“Mentions” finds public posts that talk about your brand, products or competitors. Press “Listen for something” and fill in the words or phrases, separated by commas. You can also list words to leave out, give the topic a name and choose where to look."),
        {
          type: "table",
          headers: ["Where", "How it is checked"],
          rows: [
            ["Reddit", "Posts across Reddit, checked every hour."],
            ["Threads", "Recent posts, every 2 hours. Needs a connected Threads account."],
            ["Instagram", "Hashtags only (one-word keywords), every 6 hours. Needs a connected Instagram account."],
            ["X", "Recent posts, once a day. Needs a connected X account."],
          ],
        },
        p("LinkedIn and Facebook do not let apps search public posts, so they cannot be listened to. Mentions appear under “New”, “All” or “Ignored”. For each one you can “Open on” the network, mark it “Seen”, “Ignore” it, or press “Add to leads” to add the person behind it to Leads. “Search now” on a topic looks straight away."),
      ],
    },
    {
      id: "results",
      heading: "Results and what each number means",
      blocks: [
        p("“Post results” shows how your published posts did. The numbers are read from each network every few hours after a post goes live. Until then the post says “No numbers yet.” A network may not report every number, and Social then shows nothing rather than a guess."),
        {
          type: "table",
          headers: ["Number", "What it means"],
          rows: [
            ["Reach", "How many people saw the post. Where a network does not report reach, Social shows views instead."],
            ["Views", "How many times the post was shown. One person can see it more than once."],
            ["Engagements", "The network's count of reactions and interactions on your posts."],
            ["Engagement rate", "Engagements as a percentage."],
            ["Likes, Comments, Shares, Saves", "The network's own counts for each."],
            ["Clicks", "Clicks on the post, as the network reports them."],
            ["Tracked link clicks", "Clicks on the short links Social put in your post. See below."],
            ["Leads, Meetings booked", "Leads and meetings the post brought in. They show only when there are some."],
            ["Followers", "Follower counts per network and the change over 30 days."],
          ],
        },
        p("The page also shows a “Best times to post” panel, and the numbers by publish day. Posts made in test mode are left out."),
        p("Under “Post results” there is also a Reports panel. Press “New report”, choose a name, a period (last 7, 30 or 90 days), the networks, the email addresses, and how often to send it: “Only when I press Send”, “Every Monday” or “On the 1st of each month”. “Preview” shows it, “Share to somebody” emails it now, and “Copy link” gives a link that shows the latest numbers for 120 days. If email is not set up for your company, you can still share the link."),
        p("“Audience & ideas” shows who you are talking to and what to post about."),
      ],
    },
    {
      id: "tracked-links-and-test-mode",
      heading: "Tracked links and test mode",
      blocks: [
        p("Under “Accounts”, in “Testing and links”, two switches change how posts behave."),
        {
          type: "table",
          headers: ["Switch", "What it does"],
          rows: [
            ["Track clicks on links", "Links in posts go out as short links with tracking tags. Clicks show in Results, and visits show in your own analytics. You can switch it off for any single post."],
            ["Test mode", "You can try the whole flow (approval, scheduling, publishing, alerts) without posting anything. No account needs to be connected. Test posts are left out of the results."],
          ],
        },
        p("With test mode on, a yellow bar says “Test mode is on. Posts go through approval and publishing, but nothing is sent to any network.” Choose what happens when a post goes out: “It posts (pretend)”, “The network refuses the login”, “The network is busy (tests automatic retries)” or “The network refuses the post”. A test post is marked “Posted in test mode: not sent to any network”."),
        p("Remember to switch test mode off. While it is on, approved posts do not go live."),
      ],
    },
    {
      id: "credits",
      heading: "Credits",
      blocks: [
        p("Social has its own credits, separate from Leads and Voice. Planning questions and reading your posts, results and accounts are free. These actions use Social credits at the starting rates below."),
        {
          type: "table",
          headers: ["Action", "Credits"],
          rows: [
            ["An AI-written post", "2 per post"],
            ["An AI picture redraw", "1 per picture"],
            ["An AI video clip", "20 per clip"],
          ],
        },
        p("Your plan page shows the rates currently in force, under “Credits are used like this”. When Social credits reach zero, only Social pauses; your other apps keep working. AI writing that was waiting is held and nothing is charged for it until you top up."),
      ],
    },
    {
      id: "what-social-never-does",
      heading: "What Social never does without you",
      blocks: [
        {
          type: "table",
          headers: ["Social never...", "Because"],
          rows: [
            ["Publishes a post you have not approved", "Every post needs a yes. The one exception is an import where you ticked “Approve them now”."],
            ["Puts an outline on the calendar by itself", "The assistant only proposes. Posts are created when you press “Write these posts”."],
            ["Posts twice", "A retry only happens when no network took the post."],
            ["Sends a post to a network in test mode", "Test mode keeps everything inside Social."],
            ["Publishes late on its own after a missed approval", "A post that was not approved in time becomes “Approval missed” and waits for you."],
            ["Changes a post you edited by hand through a bulk chat request", "Hand-edited posts show “Changed by hand” and are left alone."],
          ],
        },
      ],
    },
  ],
};
