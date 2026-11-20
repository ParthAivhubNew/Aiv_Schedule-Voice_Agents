const p = (text) => ({ type: "paragraph", text });

export const accountDoc = {
  id: "account",
  path: "/help/account",
  title: "Account and billing",
  summary: "Signing in, the home screen, plans and credits for each app, your team and what each person can do, and your own profile.",
  sections: [
    {
      id: "signing-in-and-up",
      heading: "Signing in and creating an account",
      blocks: [
        p("Go to the sign-in page and enter your email and password. Press “Sign in”. If your company has Google sign-in switched on, “Continue with Google” also appears."),
        {
          type: "steps",
          items: [
            "To create an account, choose “Create account”. Enter your company name, your name, your email and a password of at least 8 characters.",
            "We email a confirmation link. It works for 3 days. Open it, then sign in. If it did not arrive, press “Send it again”.",
            "You become the Admin of a new company workspace. A new workspace starts with zero credits and pays as it goes, so buy a plan or a top-up for the apps you want.",
          ],
        },
        p("If you forget your password, press “Forgot password?” and enter your email. A reset link works for 1 hour. If email is not switched on, ask your admin to reset your password from “Users & roles”."),
        p("If you already have an account with the email you typed, the page sends you to sign in instead."),
      ],
    },
    {
      id: "home-screen-and-apps",
      heading: "The home screen and switching apps",
      blocks: [
        p("The home screen shows three apps, side by side. Each is bought on its own."),
        {
          type: "table",
          headers: ["App", "Role", "What it does"],
          rows: [
            ["Leads", "Find & email", "Find verified target accounts and decision makers, run automated multi-step email sequences, and manage mailboxes."],
            ["Voice", "AI phone calls", "AI agents that call your prospects, hold the conversation and book meetings while you supervise."],
            ["Social", "Plan & publish posts", "Plan posts in a chat, see them on a calendar, then approve and publish across your channels."],
          ],
        },
        p("Under the three apps is a “Workflows” card, which opens automations that work across all three. Under that are “Support” and “Documentation” buttons."),
        p("Admins see more on each app card. A green plan name shows the plan the company holds. The card also shows credits left, or “Out of credits: paused until you top up”. For an app with no plan it shows the price it starts from (“From” and the monthly price), with “See plans” and “Try it”. With a plan it shows “Open” and “Manage plan”. Anyone can open an app to try it before buying."),
        p("Once you are inside an app, the name of the app sits under the Outreach name at the top of the left menu. Press it and “Switch app” lists the others. Pressing the Outreach name takes you home."),
        p("On a phone, the home screen is three large tiles. Plans and credits are in the profile menu and inside each app."),
      ],
    },
    {
      id: "plans-and-credits",
      heading: "Plans and credits, per app",
      blocks: [
        p("Each app has its own plan and its own credits. Leads credits, Voice credits and Social credits are separate wallets. Running out in one app pauses only that app. The other apps keep working."),
        p("Admins manage a plan from inside the app. Open the app and choose “Plan & credits”, or press “Manage plan” or “See plans” on the home screen. The page for an app shows these parts."),
        {
          type: "table",
          headers: ["Part", "What it shows"],
          rows: [
            ["Credits", "Your balance for this app. Voice credits can be shown as minutes of calls."],
            ["Your plan", "The plan name, its monthly price, the credits it gives each month, and the renewal date. “Cancel plan” or “Keep my plan”."],
            ["Credits are used like this", "The current rate for each action in this app."],
            ["Monthly plans", "The plans on sale. “Subscribe”, “Upgrade” or “Downgrade”."],
            ["One-off top-ups", "Extra credits you buy once. Choose how many, then “Buy”."],
            ["Card & invoices", "Opens the page where you update your card and see invoices. It appears once you have a payment on file."],
            ["Latest activity", "A list of credits added and spent, with dates."],
          ],
        },
        p("Prices show with “+ VAT” when VAT is added. Cards from other countries see and pay in their own currency."),
      ],
    },
    {
      id: "how-plans-work",
      heading: "How plan changes, top-ups and cancelling work",
      blocks: [
        {
          type: "table",
          headers: ["You do this", "What happens"],
          rows: [
            ["Subscribe", "You go to a secure card checkout. When you come back, your plan and credits appear within a minute."],
            ["Upgrade", "Your card is charged the difference for the rest of this period, and the extra credits are added straight away."],
            ["Downgrade", "The change happens at your next renewal. This period's credits stay until then and nothing is refunded."],
            ["Buy a top-up", "The credits are added. Top-up credits never expire. They are used after your plan credits."],
            ["Cancel plan", "It stays active until the end of the period, then stops. It will not renew. The current month is not refunded. Plan credits left over expire that day, but top-up credits stay."],
            ["Keep my plan", "Press it before the end date to undo a cancellation. It renews as usual."],
          ],
        },
        p("Plan credits do not carry over. Unused credits are replaced when the plan renews. Cancelling asks why, and the reasons are: “It costs too much”, “I am not using it enough”, “It is missing something I need”, “I am switching to another tool”, “I just need a break” or “Something else”."),
        p("If a payment fails, a red bar says “Your last payment failed. Update your card in Card & invoices.”"),
        {
          type: "callout",
          tone: "note",
          title: "Only admins buy",
          text: "Plans, top-ups and the rate table are for admins. Other people see “My credit use” instead, which shows what they spent.",
        },
      ],
    },
    {
      id: "what-uses-credits",
      heading: "What uses credits",
      blocks: [
        p("These are the starting rates. Your plan page always shows the current ones under “Credits are used like this”. An action that is free shows no rate."),
        {
          type: "table",
          headers: ["App", "Action", "Credits"],
          rows: [
            ["Voice", "A call, per minute", "1 per minute"],
            ["Voice", "A WhatsApp message sent", "1 per message"],
            ["Voice", "A written transcript and summary of a call you made from the browser", "1 per minute of call"],
            ["Voice", "A phone number, per month", "1 per number a month"],
            ["Voice", "Setting up a number", "5 per number"],
            ["Voice", "Checking imported phone numbers", "1 per 5 numbers"],
            ["Leads", "Researching a lead", "5 per lead"],
            ["Leads", "A deep web search", "5 per search"],
            ["Leads", "A social page found", "2 per page"],
            ["Leads", "An email sent", "1 per email"],
            ["Leads", "A registry check", "1 per company"],
            ["Leads", "A contact email check", "2.5 per email found"],
            ["Leads", "Personalised email lines", "1 per 5 lines"],
            ["Leads", "A phone check", "1 per 5 numbers"],
            ["Social", "An AI-written post", "2 per post"],
            ["Social", "An AI picture redraw", "1 per picture"],
            ["Social", "An AI video clip", "20 per clip"],
          ],
        },
        p("A Voice credit is a minute of calls, unless your plan page says otherwise. Before a call or a list that may be cut short, you are warned: for example “Only 3 call minutes left; your calls average 4 minutes.” You can call anyway. The call then ends when the minutes run out, with a wrap-up a minute before."),
        p("When an app's credits hit zero, the message reads “USR-01: Out of Voice credits. Top up to carry on; nothing more is charged until you do.” with the name of the app that ran out in place of Voice."),
      ],
    },
    {
      id: "team-and-permissions",
      heading: "Team members and permissions",
      blocks: [
        p("Open the profile menu at the top right and choose “Users & roles” under Admin Controls. The window is called “Users, roles, numbers & credits” and has four tabs: “Users”, “Roles”, “Phone numbers” and “Plans & credits” (admins) or “My credit use” (everyone else)."),
        {
          type: "steps",
          items: [
            "On “Users”, press “Add user”.",
            "Enter a full name, a username and optionally an email. Tick one or more roles. With none ticked, the person gets “Operator”.",
            "Press “Create user”. A temporary password appears once. If you gave an email it is also emailed. They must choose their own password the first time they sign in.",
          ],
        },
        p("Press “Manage” on a person to change their roles, give them extra access for one section, press “Reset password” or “Disable” them. A disabled person cannot sign in. Everyone needs at least one role. You cannot disable yourself."),
        p("Each role gives every section one of three levels: “No access” (hidden), “View only” (read, no changes) or “Full access” (read and change). A person with several roles gets the highest level in each section. The sections are below."),
        {
          type: "table",
          headers: ["Section", "What it covers"],
          rows: [
            ["Calling (Voice)", "Contact lists, dialling, live calls, call history, schedule and AI templates."],
            ["Analytics (Voice)", "Call and meeting results, trends and team performance."],
            ["Social", "Planning, writing, approving and publishing social posts."],
            ["Leads", "Finding and enriching companies and contacts."],
            ["Email outreach", "Email campaigns and sequences."],
            ["Meetings & calendar", "Booking pages, event types and bookings."],
            ["Company profile", "Company details, services, FAQs and knowledge sources."],
            ["Connections & AI", "Phone, AI and provider accounts and keys."],
            ["Users & roles", "Adding users, roles and who can see what."],
          ],
        },
        p("Four starter roles are made for every company."),
        {
          type: "table",
          headers: ["Role", "What it can do"],
          rows: [
            ["Admin", "Full access to everything, including users, roles and keys."],
            ["Manager", "Runs campaigns and approves posts. Full access to calling, Social, Leads, email, meetings and company profile. View only on connections. No users, roles or analytics."],
            ["Operator", "Makes calls and drafts posts. Full access to calling, Social, Leads, email and meetings. View only on company profile and connections."],
            ["Viewer", "Can look but not change anything. View only on calling, Social, Leads, email, meetings and company profile."],
          ],
        },
        p("You can also make your own roles with “New role”. The “Admin” tickbox in a role gives full access to everything."),
      ],
    },
    {
      id: "your-profile",
      heading: "Your profile",
      blocks: [
        p("Open the profile menu and choose “Your profile”. It has four tabs."),
        {
          type: "table",
          headers: ["Tab", "What you can change"],
          rows: [
            ["Profile", "Photo (JPG, PNG or WebP, up to 2 MB), first and last name, job title, department, company and a short bio."],
            ["Contact & settings", "Email, a second email, phone, website or LinkedIn, Timezone, Language, Date format, Clock (24-hour or 12-hour) and your email signature."],
            ["Notifications & account", "Which emails we send you. Also shows your username, role, organisation, member since and last sign-in."],
            ["Security", "Change password, automatic sign-out limits, and where you are signed in."],
          ],
        },
        p("Press “Save changes” to keep what you changed, or “Discard”. If you change your email address you need to verify the new one."),
      ],
    },
    {
      id: "timezone",
      heading: "Time zones",
      blocks: [
        p("There are two time zones, and they do different jobs."),
        {
          type: "table",
          headers: ["Setting", "Where", "Used for"],
          rows: [
            ["Your Timezone", "“Your profile”, tab “Contact & settings”", "How times show for you."],
            ["The company Timezone", "The company details in Voice (“Company”, the “Timezone” box)", "Call windows, meetings, and the times of Social posts. Social says “Times in” the zone under the month name."],
          ],
        },
        p("A caller's own time zone, worked out from their phone number, is used only when checking whether it is a sensible time to call them. Set the company zone to where your team works."),
      ],
    },
    {
      id: "notifications",
      heading: "Notifications",
      blocks: [
        p("Under “Notifications & account” tick the emails you want. Admins get all of them by default. Everyone else gets only what concerns them."),
        {
          type: "table",
          headers: ["Email", "On by default for"],
          rows: [
            ["A meeting is booked", "Admins"],
            ["Your week across Lead Gen, Voice and Social (Mondays)", "Admins"],
            ["A call needs a person to follow up", "Admins"],
            ["Posts are waiting for approval", "Admins"],
            ["AI writing I started has finished (when it took a while and I'd left)", "Everyone"],
            ["A scheduled post could not be published", "Admins"],
            ["A scheduled post went live", "Nobody (you choose)"],
            ["Credits are running low", "Admins"],
            ["A plan is cancelled or ends", "Admins"],
            ["Phone numbers and business verification updates", "Admins"],
            ["A WhatsApp message needs a person to reply", "Admins"],
            ["Security: password reset or account disabled", "Everyone"],
          ],
        },
        p("The bell at the top right of every app shows notifications inside the app. If you have no email on your profile, add one on “Contact & settings”."),
      ],
    },
    {
      id: "password-and-sessions",
      heading: "Password and signing out",
      blocks: [
        p("Under “Security”, enter your current password and a new one twice, then press “Change password”. If the two new passwords differ, it says “The two new passwords do not match.”"),
        p("“Where you are signed in” lists your devices with the last time each was active. Press “Sign out” on a device, or “Sign out everywhere else”."),
        p("“Automatic sign-out” signs everyone in your company out after a set time idle and a set time since sign-in, with a warning first. Admins can make these limits stricter than the platform's limits, not longer. Open screens pick up a change within 10 minutes."),
      ],
    },
    {
      id: "help-and-support",
      heading: "Other menu items",
      blocks: [
        {
          type: "table",
          headers: ["Menu item", "What it does"],
          rows: [
            ["Your profile", "Photo, details and security."],
            ["Connections", "How Leads, Voice and Social work together."],
            ["Support", "Report an issue or ask a question."],
            ["Documentation", "Opens this guide in a new tab."],
            ["Install the app", "Adds Outreach to your home screen, when your device allows it."],
            ["Calendar & meetings", "Admins: invite mail, embeds and host sync."],
            ["Admin APIs & Webhooks", "Admins: the Voice, Leads and Social APIs and keys."],
          ],
        },
        p("The “Get started” list on the home screen, shown to admins until it is done or hidden, has six steps: “Describe your company”, “Set your working hours”, “Add a phone number”, “Invite your team”, “Connect a mailbox” and “Make your first call”."),
      ],
    },
  ],
};
