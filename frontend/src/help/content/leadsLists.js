const p = (text) => ({ type: "paragraph", text });

export const leadsListsDoc = {
  id: "leads-lists",
  path: "/help/leads/lists",
  title: "Lists",
  summary: "Keep the companies you save in named lists, check and improve them, then start a journey or a call run.",
  sections: [
    {
      id: "what-lists-are",
      heading: "What a list is",
      blocks: [
        p("Everything you save from Find Leads, and every file you import, lands in a list. A list is a named group of companies. It only remembers which companies are in it. The companies themselves belong to your account, so one company can be in several lists at once."),
        p("The Lists page has three tabs: “Lists”, “Companies” and “People”. “Lists” shows each list as a row. “Companies” shows every company you have saved, whichever list it is in. “People” shows the named contacts at those companies."),
        p("At the top of the “Lists” tab are three buttons. “Find companies or import a file” takes you to Find Leads. “New list” creates an empty list. “Add one by hand” lets you type in a single company."),
        {
          type: "table",
          headers: ["Limit", "Value"],
          rows: [
            ["Lists you can keep", "200"],
            ["Characters in a list name", "80"],
            ["Companies added to a list in one go", "5,000"],
          ],
        },
      ],
    },
    {
      id: "lists-tab",
      heading: "The Lists tab",
      blocks: [
        p("Each row is one list. The first row is always “All companies”, which holds every company you have saved. Click a row, or “Open”, to see what is inside."),
        {
          type: "table",
          headers: ["Column", "What it means"],
          rows: [
            ["List name", "The name. A pencil beside it renames the list. Under the name you may see a count of companies moved to “Needs your choice” after the register check, and a calling progress line such as “called 29 of 42 · 6 interested” once calling is part of your plan."],
            ["Companies", "How many companies are in the list."],
            ["Ready to email", "Companies with an email that passed the checks and that you have not yet contacted."],
            ["With an email", "Companies with any email we can send to."],
            ["Avg fit", "The average fit score of the companies that have one. Only appears after you set your ideal customer under “About your business”."],
            ["Owner", "Who created the list. Only appears when lists have owners."],
            ["Source", "Where most of the companies came from: AI Lead Scout, AI Lead Copilot, Import, Added by hand or Web form. “Mixed” means no single source has more than half."],
            ["Last changed", "When companies were last added or taken out: Today, Yesterday, or the date."],
          ],
        },
        p("“Ready to email” is usually lower than “With an email”. A company can have an email but not be ready. It may be held until a register match or consent is settled, it may already have been contacted, or its email may have failed a check."),
      ],
    },
    {
      id: "unsorted",
      heading: "Unsorted: companies in no list",
      blocks: [
        p("When you press “Save” in Find Leads, the company goes into a list called “Unsorted”. Saving that way, and “Save & call” or “Get contacts” on companies you have not saved yet, all use it. Unsorted is a normal place to park companies until you decide where they belong."),
        p("The Lists page also shows a view of companies that are in no list at all. This is not stored anywhere. It is worked out each time you look. It is called “Unsorted”, or “Not in any list” if you already have a real list called Unsorted. Take a company out of its last list, or delete a list, and it appears there. It stays out of the view once you put it in a list."),
        p("Because it is a view, you cannot delete it. If you rename it, or add companies to it, it becomes a real list with that content. Nothing is lost either way."),
        {
          type: "callout",
          tone: "tip",
          title: "Sort as you go",
          text: "After a search, select the companies you want and use “Add to list” to name a list straight away. A list named for the job, such as Leeds accountants, is easier to find than a long Unsorted list.",
        },
      ],
    },
    {
      id: "create-rename-merge",
      heading: "Create, rename and merge",
      blocks: [
        p("There are four ways to create a list."),
        {
          type: "steps",
          items: [
            "Press “New list”, type a name such as Leeds dentists, and press “Create list”. You land in the empty list.",
            "In Find Leads, select companies, press “Add to list” and type a new name.",
            "Import a file. You choose the list name, which starts as the file name.",
            "Save a search with “Save the search and make the list”. The list is made for you and fills itself.",
          ],
        },
        p("Names are not case-sensitive and must be different. If you reuse a name you get “You already have a list called …”. A list needs a name of up to 80 characters."),
        p("To rename a list, click the pencil beside its name, or choose “Rename” from the menu inside the list. Type the new name and press “Save”, or press Enter. Escape keeps the old name. “All companies” cannot be renamed or deleted."),
        p("There is no separate merge button. To merge one list into another, open the first list, select every company, press “Add to list”, and choose the second list. The companies are in both lists afterwards. A company that is already in the target is not added twice, and the message tells you how many were already there. Then delete the first list if you no longer want it. Deleting a list never deletes companies."),
        p("The “Add to list” box has a drop-down of your lists and the option “+ A new list”. After you press “Add” you see a message such as “Added 12 companies to the list. 3 companies were already in it.” Companies that are not saved in Leads yet cannot be added, and the message says so."),
      ],
    },
    {
      id: "inside-a-list",
      heading: "Inside a list",
      blocks: [
        p("Open a list to see its companies. The heading shows the name and a summary such as “42 companies · 31 with an email”. “← All lists” takes you back."),
        p("The companies are grouped by what to do next, in tabs above the table."),
        {
          type: "table",
          headers: ["Tab", "Meaning"],
          rows: [
            ["All", "Every company in the list, whatever its status."],
            ["Ready", "Has an email that passed the checks."],
            ["Needs contact", "No email we can send to yet."],
            ["Reach another way", "Sole traders and individuals. A call, letter or LinkedIn task instead of email, until they agree to email."],
            ["Contacted", "You have already been in touch."],
            ["Needs your choice", "We found more than one phone or email and you need to pick the right one. Appears only when there are some."],
          ],
        },
        p("Each tab shows a count. The list opens on the first tab that has companies. A “More filters” menu adds filters that appear only when something matches: “New data found”, “Fixes to review”, “Due for deletion” (not contacted for 12 months), “Import warnings”, and the results of checks."),
        p("The table can show these columns: Company, Fit, Phone, Email, Contact, Stage, Complete, Check, Website and “First seen via”. “Complete” shows how much of the website, phone, email, address, industry, people and size we hold. Hover a row to see what is missing. “Check” says whether the company, its website and its email look real. “Columns” and the layout switch let you hide what you do not need, and “Save this view” remembers a set of columns, tab and filter under a name."),
      ],
    },
    {
      id: "duplicates-and-flags",
      heading: "Duplicate flags and what they mean",
      blocks: [
        p("A small badge beside a company name warns of a possible duplicate in the same view. Hover it to read the reason."),
        {
          type: "table",
          headers: ["Badge", "Meaning"],
          rows: [
            ["Possible duplicate", "Another row has the same company number, the same website, or the same name and postcode."],
            ["Shared phone", "Another company in this list has the same phone number."],
          ],
        },
        p("Different named contacts at one company are separate rows on purpose, so they are not flagged. A shared mail or social host, such as a gmail.com address or a Facebook page, says nothing about whether two companies are the same, so those are not flagged either."),
        p("When you save or import, a company you already hold is not copied. It is matched by its register record first, then by website, then by name and place, and the existing one is added to the list instead. A flag in a list is a reminder to look. It does not remove anything. Open both rows and delete the one you do not want."),
        p("“Import warnings” in “More filters” shows problems noticed when a file was imported, such as a company number that belongs to a different company."),
      ],
    },
    {
      id: "readiness",
      heading: "Readiness: is it ready to email?",
      blocks: [
        p("Each company has one readiness answer. It decides which tab the company sits in and what the “Ready to email” count shows."),
        {
          type: "table",
          headers: ["State", "Meaning"],
          rows: [
            ["Ready", "It has an email that passed the checks, nothing blocks sending, and you have not contacted it."],
            ["Needs contact", "No email we can send to yet. Use “Get contacts”."],
            ["Needs attention", "Closed or dissolved, a website or email that does not work, a company number in your file that is wrong, or a contact who cannot be emailed yet."],
            ["Fixes to review", "We found a better value than the one you gave. Nothing changes until you accept it. “Accept” uses the suggested value and keeps your original beside it. “Accept all fixes (N)” in the menu applies every suggestion in the list."],
            ["Reach another way", "A sole trader or individual. Use a call, a letter or LinkedIn until they agree to email."],
          ],
        },
        p("After a check against the register, a company that has an email can move to “Needs your choice” until its match or consent is settled. A line above the table says how many moved. Settle each one to bring it back to “Ready”."),
        p("“How they agreed” in the list menu opens a short form. Use it to record how these contacts agreed to hear from you, so sole traders among them can be emailed. It appears for imported lists and lists with people who might be sole traders."),
        p("Where there is an address, the “Check” column says whether it passed. A check only fills blanks. A value you typed that looks wrong is never overwritten. It is offered as a fix you can accept."),
      ],
    },
    {
      id: "get-contacts-and-reveal",
      heading: "Get contacts and Reveal",
      blocks: [
        p("Inside a list you can select companies and use “Get contacts” or “Reveal”. They work as they do in Find Leads."),
        {
          type: "table",
          headers: ["Button", "What it does", "Cost"],
          rows: [
            ["Reveal N", "Shows the website, phone and email our register already holds. Appears when some are held back.", "Free."],
            ["Get contacts", "Looks for what the company is missing. A box shows the most it can cost before anything is charged.", "Charged only for what is found. Unused credits are given back."],
          ],
        },
        p("The cost box lists the steps in order, cheapest first: our own records and format checks (free), the company register (free), the deep web search, phone number checks, email checks, and social pages. It shows each price and your balance. If the most it could cost is more than your balance, it offers a top-up. You can cancel a running job. Companies already done keep their results, and credits held for the rest are given back."),
        p("A company that is being checked cannot be removed from a list or deleted until the check finishes. The buttons are greyed out and say so."),
      ],
    },
    {
      id: "remove-or-delete",
      heading: "Remove from a list or delete from your account",
      blocks: [
        p("These two actions are different. Know which one you are pressing."),
        {
          type: "table",
          headers: ["Action", "Where", "What happens"],
          rows: [
            ["Remove from list", "Select companies inside a list and press “Remove from list”.", "They leave this list only. They stay in your account and in your other lists."],
            ["Delete list", "The list menu, “Delete list”.", "Deletes the list only. The companies stay in your account and in your other lists."],
            ["Delete", "Select companies and press “Delete”.", "Deletes them for good. They leave your saved companies, every list and any journey they are in. This cannot be undone."],
            ["Remove (single company)", "In a company’s panel under “Details”.", "Removes that one company from all your lists for good."],
          ],
        },
        p("Bulk delete asks twice. First it confirms the number: “Delete N companies?”. Then it asks “Also stop anyone contacting them?”. Press “Yes, block them” to add their emails and phone numbers to your do-not-contact list. Use this for an erasure request, when someone asks you to forget them. Press Cancel to delete without blocking."),
        p("Bulk delete handles up to 5,000 companies at a time. If you select more, the message says how many were not deleted and tells you to run it again. Companies being checked at that moment are kept, and the message says how many."),
        {
          type: "callout",
          tone: "warning",
          title: "Delete is permanent",
          text: "Delete cannot be undone. If you only want a company out of one list, use “Remove from list”.",
        },
        p("“Review old contacts” in the list menu shows companies nobody has contacted for 12 months, so you can keep what you need and delete the rest."),
      ],
    },
    {
      id: "people-tab",
      heading: "The People tab",
      blocks: [
        p("“Lists · People” shows every person at the companies you saved: who they are, how to reach them, and where each company stands."),
        {
          type: "table",
          headers: ["Column", "What it shows"],
          rows: [
            ["Name, Job title, Company", "The person, their role, and the company they work at."],
            ["Email, Phone", "What you saved or what a check found."],
            ["Stage", "Where that company is in your work with them."],
            ["Where from", "“Found by a company check” or “Saved or imported”."],
          ],
        },
        p("A person appears when a saved company has a contact name, from your import or from a company check that found the team. Use the box “Search people by name, title, company or email” to filter."),
        p("If you see “No people yet”, open “Companies”, use “Get contacts” on your companies, and come back."),
      ],
    },
    {
      id: "start-a-journey",
      heading: "Starting a journey from a list",
      blocks: [
        p("A journey is a path of emails, calls and tasks for each person. Start one from a list when the list has emails to send to."),
        {
          type: "steps",
          items: [
            "Open the list.",
            "Make sure some companies are in “Ready”. If none have an email, the button is greyed with “None of these companies has an email yet. Use Get contacts first.”",
            "Press “Start journey”. The journey setup opens with this list chosen.",
            "Follow the steps. The Journeys guide covers them.",
          ],
        },
        p("You can also select companies on the “Companies” tab and press “Start journey”. We put the ticked companies that have an email into a new list, ask you to name it (the suggested name is a date and time), and then open the journey setup. Only companies with an email go into that list."),
        p("At the standard rate, each email sent uses 1 credit. See the Leads overview for where credits are used. A journey stops for a person when they reply, book or opt out."),
      ],
    },
    {
      id: "call-list-handoff",
      heading: "Calling a list and the Voice handoff",
      blocks: [
        p("The list menu has two call options."),
        {
          type: "table",
          headers: ["Menu item", "What it does"],
          rows: [
            ["Call this list", "Have your AI caller phone the list. A box shows who will be called before it dials. Without Voice on your plan the item reads “Call this list · add Voice”."],
            ["Review in Voice", "Opens the same companies on the Voice call list so you can look them over and change them before calling. Appears when Voice is on your plan."],
          ],
        },
        p("The call box skips anyone without a phone number, anyone on your do-not-contact list, and anyone you contacted lately. It shows you who it will call before it dials. If no company in the list has a phone number, “Review in Voice” says “None of these companies has a phone number yet. Use Get contacts on them first.”"),
        p("While a list is open and Voice is on your plan, the app remembers it. When you switch to Voice, you can bring the list with you. “Call” in the selection bar does the same for just the companies you ticked."),
        p("Calling progress shows on the list row and inside the list, for example “called 29 of 42 · 6 interested”. A company counts as called once a call has happened. It counts as interested when its stage is interested, meeting or won."),
      ],
    },
    {
      id: "import",
      heading: "Importing a file into a list",
      blocks: [
        p("Press “Import” in the page header, or “Find companies or import a file” on the “Lists” tab. Choose “Upload CSV / Excel”, check how your columns map to our fields (“Edit column matches” changes it), name the list, and press the button to add the companies."),
        p("The import has an optional tick that checks the companies against our own records only. Nothing is charged for it, and the import itself costs nothing. Companies you already hold are not copied. They are matched and added to the list, and the file fills any blanks they had. An imported company is marked “Import” as its source."),
        p("Large files are sent in batches, so a big file shows how far it has got. When the import finishes, “Open the list” takes you to it."),
      ],
    },
    {
      id: "list-problems",
      heading: "Common problems",
      blocks: [
        {
          type: "table",
          headers: ["What you see", "What it means and what to do"],
          rows: [
            ["“You already have a list called …”", "List names must be different, ignoring case. Choose another name or open that list."],
            ["“You can keep up to 200 lists. Delete one first.”", "You have reached the limit. Merge small lists into larger ones and delete the empty ones."],
            ["“Some of these companies are being checked right now”", "A check is running. Take them out of the list, or delete the list, when it has finished."],
            ["“Start journey” is greyed out", "No company in the list has an email yet. Use “Get contacts” first."],
            ["Ready to email is lower than With an email", "Some companies with an email are held for a register match or consent, already contacted, or failed a check. Look in “Needs your choice” and “Fixes to review”."],
            ["“N more were not deleted (the limit is 5,000 at a time)”", "Run the delete again for the rest."],
            ["A company is missing from the list after a delete or removal", "Check “Unsorted” or “Not in any list”. A company removed from its last list appears there."],
            ["Added N, but I selected more", "The rest were already in the list, or were not saved in Leads yet. The message gives both counts."],
          ],
        },
      ],
    },
  ],
};
