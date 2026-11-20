const p = (text) => ({ type: "paragraph", text });

export const leadsFindDoc = {
  id: "leads-find",
  path: "/help/leads/find",
  title: "Find leads",
  summary: "Search the company register by industry, place, size and more, then save the companies you want to a list.",
  sections: [
    {
      id: "what-find-leads-is",
      heading: "What Find Leads shows",
      blocks: [
        p("Find Leads searches our company register. The register holds registered companies, plus sole traders and premises we could match from other registers. When you open the screen with no filters, you see the whole register, best profiles first. Filters narrow it down."),
        p("Searching the register costs no credits. Credits are only used when you ask us to look for a contact detail we do not already hold. The sections below say exactly when."),
        p("The screen has three parts. The filter panel is on the left. The results are on the right. Along the top are the “Company name” box, “Saved searches”, the “Companies” and “People” switch, and the “List” and “Map” switch. On a phone, the panel and the results are two panes, called “Search” and “Results”."),
        {
          type: "table",
          headers: ["Column", "What it shows"],
          rows: [
            ["Company", "The name, with a small label for where the record came from: “Registry” (read from the official record), “Website”, “Web” (found by a web search), or “Premises listing” (listed as a premises, not matched to a company number)."],
            ["Fit", "Only appears once you have set your ideal customer under “About your business”. “Strong fit” is 70 or more out of 100, “Some fit” is 40 to 69, “Weak fit” is below 40. Hover to see the reasons."],
            ["Industry", "What the company does, in plain words."],
            ["Location", "The town and postcode."],
            ["Website, Phone, Email", "The detail if we hold it and you have opened it. Otherwise a button: “Reveal”, “Get contacts”, “Find website”, “Find phone” or “Find email”. See the section on contacts below."],
            ["Links", "Icons for the website, LinkedIn page, Facebook page and X profile. A faint icon means we have not found that page yet. Click it to look."],
            ["Size (accounts)", "Micro, Small, Medium / large or Dormant. This comes from the accounts the company files. It is not a headcount."],
          ],
        },
        p("Click a company name to open its profile in a side panel. “Open page” in the panel opens the full page for that company."),
      ],
    },
    {
      id: "companies-and-people",
      heading: "Companies and People tabs",
      blocks: [
        p("The “Companies” tab lists companies. The “People” tab lists the people the register names at the companies that match your filters, such as directors and secretaries. The filters are shared: change a filter on one tab and it applies to the other."),
        p("The People tab adds one filter group, “Job title”, with a “Role includes” box. Type a word from the role, such as director or secretary. The button changes from “Find companies” to “Find people”."),
        p("People columns are “Name”, “Role”, “Company”, “Location”, “Email”, “Company phone” and “On the register since”. The heading shows how many people you have and how many companies they work at, for example “40 people · at 12 companies”."),
        p("Not every company has its people on file yet. Where some are missing, a bar says “Some of these companies have no people on file yet. Reading them from the registry is free.” Press “Find people at the next N companies” to read them. The page reads them in the background, shows progress, and has “Stop and show what is found”. Reading people from the register is free."),
        {
          type: "callout",
          tone: "note",
          title: "Names are public, emails are not",
          text: "The register publishes names and roles. It does not publish personal emails. A person’s email is only found on request, one person at a time, with “Find email”. The price shows on the button, and you are charged only if one is found.",
        },
      ],
    },
    {
      id: "describe-it",
      heading: "The “Describe it” box",
      blocks: [
        p("At the top of the filter panel is a box labelled “Describe what you want in words”. Type a sentence such as “accountants in Leeds, leave out charities” and press “Fill” or Enter. We read the sentence and fill in the filters below it, including what to leave out."),
        p("“Fill” does not run the search. Check the filters it filled, change anything you like, then press “Find companies”. A short message lists what it filled in. If we cannot turn the sentence into filters, you get a message and nothing changes."),
        p("Your current filters are sent with the sentence. So a second sentence can change or narrow what is already set, for example “only ones in Headingley”."),
        {
          type: "callout",
          tone: "tip",
          title: "Use it for long lists",
          text: "It is quicker to type “restaurants and cafes in Bath, leave out chains and franchises” than to fill four groups by hand. Then fix anything it got wrong in the groups below.",
        },
      ],
    },
    {
      id: "filter-groups",
      heading: "The filter groups, in order",
      blocks: [
        p("The filter panel has nine groups. Only one group is open at a time. A closed group shows its chosen values as small chips under its name. Click a chip’s cross to remove just that value. Click the cross on the group’s heading to clear the whole group. “Clear all” at the bottom clears every filter, the drawn map area and the results. Taking a filter away refreshes the list by itself. Adding or changing a filter waits until you press “Find companies”."),
        p("The “Filters” button above the results hides or shows the whole panel."),
        {
          type: "table",
          headers: ["Group", "Fields"],
          rows: [
            ["Industry & keywords", "Include, Leave out, Industry, Include side activities, Include schools & community places"],
            ["Location", "Town / city, Postcode starts with, Leave out towns, Within N miles of a postcode"],
            ["Reasons to get in touch now", "Four ticks about new directors, accounts due, overdue accounts and new companies"],
            ["Size / accounts type", "Micro, Small, Medium / large, Dormant"],
            ["Company", "Company type, legal form ticks, Registered or sole trader, Leave out charities, Leave out types, Exclusion list"],
            ["Status & age", "Trading ≥ years, Trading ≤ years, Include closed / dissolved"],
            ["Details we hold", "Has a website, Has a phone, Has an email"],
            ["Your lists", "Any, Not in my lists, In my lists"],
          ],
        },
        p("The “Company name” box at the top of the screen is separate from the groups. Type a company name such as Tesco or Smith & Sons and press Enter. It searches every registered company by name. If no company has that name, we offer to treat the words as an industry and a town instead, for example “Search dentists in Leeds instead”."),
      ],
    },
    {
      id: "industry-keywords",
      heading: "Industry & keywords",
      blocks: [
        p("This group says what kind of company you want."),
        {
          type: "table",
          headers: ["Field", "What it does"],
          rows: [
            ["Include", "Words matched against what each company does and against its name. Related words are included, so dentist also looks for dental. You can also type a company name or a company number here. The words we added show under the results as “Also looking for:”. Click the cross on one to stop looking for it."],
            ["Leave out", "Companies whose name or activity has any of these words, or that sit in one of the categories you list. See the section on Leave out and Exclusion list."],
            ["Industry", "A picker for the industries on the register. See the next section."],
            ["Include side activities", "By default a word matches a company’s main activity or its name. Tick this to also match companies that list the trade only as a side activity."],
            ["Include schools & community places", "Schools, nurseries, churches and community places are hidden by default because they are rarely buyers. Tick this to show them. They also appear if you type one of those words yourself."],
          ],
        },
        p("A common word on its own can be slow across the whole register. The box says so: “Add a town to speed it up.” A search with a trade and a town reads far fewer records."),
        p("If too few companies have your trade as their main activity, we include side-activity companies for you and say so in a line above the results. You can also see this when the results count looks larger than you expected."),
      ],
    },
    {
      id: "industry-picker",
      heading: "The Industry picker",
      blocks: [
        p("Type at least two letters, such as cafes, accountants or dentist. The list that opens shows industries that really exist on the register, each with “about N”, the number of companies that carry it."),
        p("There are three kinds of line."),
        {
          type: "table",
          headers: ["Kind", "How it looks", "What happens when you pick it"],
          rows: [
            ["SIC industry", "A code and a name, for example 69201 and Accounting activities", "Adds that SIC code as a chip. SIC codes are the official industry codes that companies register under. A short code takes every code that starts with it."],
            ["Register type", "A name tagged “Register type”, for example Charity or Restaurant/Cafe/Canteen", "Adds that exact type. Some registers, such as the food hygiene and care registers, use their own types instead of SIC codes."],
            ["A whole trade", "A name with a count of SIC codes plus register types", "Adds all its SIC codes and types as separate chips, so you can remove any one."],
          ],
        },
        p("Use SIC codes when you want companies that registered under a given industry. Use register types when the businesses you want are listed by a register rather than by company number, such as cafes and care homes. Picking a whole trade gives you both."),
        p("If nothing matches, the picker says so and reminds you that words in the “Include” box still search company names and activities. The numbers are approximate and can change as the register is updated."),
      ],
    },
    {
      id: "location",
      heading: "Location",
      blocks: [
        {
          type: "table",
          headers: ["Field", "What it does"],
          rows: [
            ["Town / city", "One or more towns, separated by commas, for example London, Leeds. A town must match the register’s spelling. If you mistype one, we ask “Did you mean Leeds?” with a button to use it."],
            ["Choose postcode areas in (town)", "Appears once you type one town. A drop-down lists that town’s postcode districts with the number of companies in each. Tick the ones you want and they are added to “Postcode starts with”. “Select all” and “Clear” are at the top of the list."],
            ["Postcode starts with", "Only companies whose postcode begins with this, for example EC1 or M1. LS1 means the LS1 district only, never LS10 to LS19. A prefix with a space or ending in a letter is read as typed."],
            ["Leave out towns", "Drops companies in these towns."],
            ["Within N miles of a postcode", "Choose 1, 3, 5, 10 or 25 miles and type a postcode, for example LS1 4AP. We turn the ring into the postcode districts inside it and show “Covers N postcode districts”. It matches the company’s registered office. A postcode we cannot look up shows an error under the field."],
          ],
        },
        p("A registered office is not always where a company trades. A company registered at its accountant’s office can show a different town from where it works. Pick the place you want, and use the map for a closer look."),
      ],
    },
    {
      id: "reasons-now",
      heading: "Reasons to get in touch now",
      blocks: [
        p("These four ticks find companies with something happening. They are based on dates the register holds."),
        {
          type: "table",
          headers: ["Tick", "What it finds"],
          rows: [
            ["New director (last 90 days)", "Companies that appointed a director in the last 90 days. Only companies whose directors we have already read from the register can match."],
            ["Accounts due in the next 60 days", "The register says their next accounts are due soon."],
            ["Accounts overdue", "The register shows a filing that is past its due date. Only active companies match."],
            ["New company (last 12 months)", "Incorporated in the last year."],
          ],
        },
        p("Closed companies never match a reason. These are timing hints, not a promise that someone is ready to buy."),
        p("These filters count towards a saved search. You can save a search that has only a reason, with no industry or place."),
      ],
    },
    {
      id: "size-company-status",
      heading: "Size, Company, Status and Details",
      blocks: [
        p("“Size / accounts type” has four chips: Micro, Small, Medium / large and Dormant. They come from the category each company files its accounts under. A micro company files the smallest accounts. This is not a headcount, so a Micro company may have a handful of staff or none."),
        {
          type: "table",
          headers: ["Field", "What it does"],
          rows: [
            ["Company type", "Free text for the legal form, such as Limited, LLP or PLC. Next to it are ticks for Ltd, PLC, LLP, CIC, By guarantee and Partnership. Any ticked form matches."],
            ["Registered or sole trader", "“Any”, “Registered company” or “Sole trader / no company number”. Sole traders are not on the company register, so this finds records we hold with no company number: sole traders, partnerships and businesses we could not match. Choosing it hides the company type fields and shows “Food hygiene register”, “Care register” and “Imported or web-found” chips, so you can limit to records from those sources. With none ticked, all sources count."],
            ["Leave out charities", "Drops charities and companies on the charity register."],
            ["Leave out types", "Legal forms to drop, for example LLP or Registered Society."],
            ["Exclusion list", "A longer list of things to drop. See the next section."],
            ["Trading ≥ years", "Only companies that have existed at least this many years."],
            ["Trading ≤ years", "Only companies no older than this."],
            ["Include closed / dissolved", "By default only active companies show. Tick this to include closed and dissolved ones."],
            ["Has a website, Has a phone, Has an email", "Only companies where we already hold that detail. A detail we hold but you have not opened still counts."],
            ["Your lists", "“Any”, “Not in my lists” or “In my lists”. Use “Not in my lists” to see only companies you have not saved."],
          ],
        },
        {
          type: "callout",
          tone: "note",
          title: "Active only by default",
          text: "Every search shows active companies only unless you tick “Include closed / dissolved”. If a company you expect is missing, check that it has not closed.",
        },
      ],
    },
    {
      id: "leave-out-and-exclusions",
      heading: "Leave out and Exclusion list",
      blocks: [
        p("Both boxes remove companies from your results. They work on different things, and you can use both."),
        {
          type: "table",
          headers: ["Box", "Where", "Best for"],
          rows: [
            ["Leave out", "Industry & keywords", "Words and categories about what a company does, such as franchise, holdings or Hospitals."],
            ["Exclusion list", "Company", "A long, mixed list: SIC codes, postcode districts, company numbers, words and whole categories."],
          ],
        },
        p("In both boxes each item becomes a chip. A tag under a heading says how the item is read."),
        {
          type: "table",
          headers: ["Heading", "How it is read", "Example"],
          rows: [
            ["Categories", "A known category. It stands for a set of name words and SIC codes, so it removes companies with those words or those codes.", "Places of Worship, Hospitals"],
            ["Words", "A word that removes companies with it in their name or trade. Plurals are accepted.", "church, casino"],
            ["SIC codes", "A code that removes companies with that code. A short code removes every code starting with it.", "56101, or 56"],
            ["Postcodes", "A postcode district that removes companies registered there.", "BN9"],
            ["Company numbers", "One company, by its number.", "01234567"],
          ],
        },
        p("Words are matched against the company name and its listed activities. They are not matched against the description, because a description says who a company serves, not what it is. “IT for schools” is not a school. A driving school or dance school is not removed by the word school unless you type driving or dance yourself."),
        p("Each chip carries a count next to its heading, and “Clear” beside a heading removes every chip of that kind. Click the cross on a chip to remove one."),
      ],
    },
    {
      id: "paste-category-list",
      heading: "Pasting a category list",
      blocks: [
        p("If another directory gave you a list of categories to avoid, you can paste it in one go."),
        {
          type: "steps",
          items: [
            "Open the box you want, “Leave out” or “Exclusion list”, and press “Expand” under it.",
            "Press “Edit as text” in the large box.",
            "Paste your list. Separate items with commas or new lines, for example: Places of Worship, Hospitals, Schools (Special), Banks and Financial Institutions.",
            "Press “Show as chips”. Each item is now a chip under the right heading. Names we know show under “Categories”. Anything else shows under “Words”.",
            "Press “Done”, then “Find companies”.",
          ],
        },
        p("You can also paste straight into the small box. A paste that contains commas or new lines is split into chips automatically."),
        p("When you type, matching categories and words drop down, with the closest one in faint text after your cursor. Press Tab or the right arrow to accept it. A comma or Enter adds what you typed. The small line under the box shows the item count, for example “12 items”."),
        {
          type: "callout",
          tone: "tip",
          title: "Check what is under Words",
          text: "A label we do not know is searched for exactly as you typed it, with plurals allowed. If a category you pasted shows under “Words” rather than “Categories”, it removes companies with that exact word. Reword it as a plain word if you want a wider match.",
        },
      ],
    },
    {
      id: "ranking",
      heading: "How results are ranked",
      blocks: [
        p("The default order is “Best match”. It puts the fullest profiles first, and within each group the biggest and best-known companies first. Results are grouped under three headings."),
        {
          type: "table",
          headers: ["Heading", "Meaning"],
          rows: [
            ["Full profiles", "Four or more of: website, phone, email, a description, people on the register, and a researched record. “Website, phone, email and more on file”."],
            ["Partial profiles", "Two or three of those six. “Some contact details on file”."],
            ["Basic records", "Registry facts only: name, address, sector, status."],
          ],
        },
        p("Within a group, size comes first. A company that files medium or large accounts and a public limited company rank higher, as do companies confirmed by more than one source and companies with a known website."),
        p("The “View” menu above the table has two sections, “Sort” and “Per page”. Sort offers “Best match”, “Newest first” and “Name A to Z”. Once you have set your ideal customer in “About your business”, “Best match” is replaced by “Best fit”, which orders by the fit score. Per page offers 25, 50, 100 or 250 and the browser remembers your choice."),
        p("If you see “Newest first · ranking not run yet”, the register has not been ranked on our side yet. Newest companies come first until it is. The “Details we hold” filters still work."),
      ],
    },
    {
      id: "counts-and-speed",
      heading: "Counts, slow searches and speed",
      blocks: [
        p("The top of the results shows three figures you can click: “All”, “New to you” and “Saved”. “All” is every match. “New to you” is the matches that are in none of your lists. “Saved” is the matches already in one of your lists. Click one to filter the list to it, and click again to clear."),
        p("Large counts stop at 10,000 and show “10,000+” at first. The real figure arrives a moment later when we can work it out. The page does not wait for it."),
        p("A search runs while a progress bar shows. “Cancel” stops it. The last results stay on screen, dimmed, so the page never empties while you wait. If a search fails you get the message and a “Try again” button."),
        {
          type: "table",
          headers: ["To speed up a slow search", "Why it helps"],
          rows: [
            ["Add a town or a postcode", "A common word across the whole register has to be checked against a very large number of records. A town leaves far fewer to check."],
            ["Pick an industry in the picker instead of typing a word", "A SIC code is a direct match. A word is matched against names and activities."],
            ["Avoid very short words", "Words need at least two letters. Short common words match too much."],
            ["Use the map for a small area", "It counts first, then reads only what you ask for."],
          ],
        },
      ],
    },
    {
      id: "map",
      heading: "Searching on the map",
      blocks: [
        p("Press “Map” beside “List” to see results as pins. A pin sits at the company’s registered postcode. Companies without a usable postcode are not on the map, but they stay in the list."),
        p("You can search by place in two ways. Type a postcode, such as LS1 4AP, in “Search around a postcode”, choose a radius and press “Go”. Or press “Draw area”, then press and drag around the area on the map. Let go to finish. Escape cancels."),
        {
          type: "steps",
          items: [
            "Set your filters first if you want, such as an industry. The area search uses them.",
            "Press “Draw area” and draw around the place. It counts the companies that could be inside. This is free and takes a few seconds.",
            "Choose how many to see: 50, 100, 250, 500, 1,000, or all of them. You can also type a number and press “Show”.",
            "Pins appear as they are found. “Stop and keep what’s found” ends the scan early.",
            "Press “Choose a number…” or a “Show N” button to load more. “Redraw area” starts a new shape. “Clear area” removes it.",
          ],
        },
        p("If no company in the area matches your filters, we say so and offer “Show every company in this area”. If nothing is inside the shape at all, draw over a UK town or a few postcodes. Our data covers the UK."),
        p("Click a pin to see the company and save it, mark it “Favourite”, “Add to list…”, add a “Note…”, “Save & call”, or press “Not interested” to take it out of these results. “Close map” returns to the list with the companies the map found."),
      ],
    },
    {
      id: "select-and-hide",
      heading: "Selecting, hiding and saving",
      blocks: [
        p("Tick the box at the start of a row to select a company. The header box selects every company on the page. When you tick a whole page and there are more matches, a notice offers to select all of them."),
        p("“Select all matching” takes every match for the current filters, up to 2,000 at a time. If your search has more than 2,000 matches, narrow it or work in batches. A drawn map area selects everything the map found."),
        p("Once you select any company, a bar shows the count and these buttons."),
        {
          type: "table",
          headers: ["Button", "What it does"],
          rows: [
            ["Save N", "Saves the selected companies to a list called “Unsorted”. A company you already saved is not copied."],
            ["Add to list", "Saves them into a list you name or choose. A new name makes a new list."],
            ["Favourite", "Saves them to a list called “Favourites”."],
            ["Get contacts (N)", "Looks for the website, phone and email these companies are missing. Only shown when some are missing."],
            ["Reveal N", "Shows details we already hold. Free. Only shown when some are held back."],
            ["Call", "Saves them and opens the call box for the ones with a number. Needs Voice on your plan."],
            ["Remove", "Hides them from this search."],
          ],
        },
        p("“Remove” only hides a company from the results on screen. It does not delete anything and it does not stop you finding the company again. The hide is cleared when you press “Find companies” again."),
        p("Saved companies show a tick and the word “Saved”. Saving never costs credits. Everything you save lands in a list. See the Lists guide for what you can do next."),
      ],
    },
    {
      id: "contacts-and-credits",
      heading: "Reveal, Get contacts and Find: what each costs",
      blocks: [
        p("A search result can hold three kinds of contact detail. Some are already in our register. Some we can look for on the web. Some we cannot find. The buttons below match those cases."),
        {
          type: "table",
          headers: ["Button", "What it does", "Cost"],
          rows: [
            ["Reveal", "Opens the website, phone and email that our register already holds for a company. Until you open them, the cell says “Held”. Once opened, they stay open for your account.", "Free. Never uses credits."],
            ["Reveal N (selection bar)", "Does the same for every selected company.", "Free."],
            ["Get contacts", "Looks for the website, phone, email and social pages a company is missing, one step at a time, cheapest first. Opens a box first that shows the most it could cost and what you would get.", "Nothing is charged until you press “Start”. You pay only for what is found. The rest is given back."],
            ["Find website, Find phone, Find email", "Looks for one detail for one company. We search the web first. Only if that finds nothing do we run the deep web search.", "Charged only when found. The price shows on the button: “N credits if found”. A miss is not charged."],
            ["Find email (a person)", "Looks for one named person’s work email, on a company’s profile panel.", "Charged only if one is found. The price shows on the button."],
            ["Look for website & phone on the web", "On a company’s profile panel, one web search for the website and phone.", "Charged only if something is found. A miss shows “nothing was charged”."],
            ["LinkedIn, Facebook, X, Instagram icons", "Look for that one page.", "Charged only when a page is found. Pages cost less than a website, phone or email."],
          ],
        },
        p("At the standard rates, a website, phone or email found on the web costs 5 credits. The deep web search costs 5 credits when it finds something, the same as the web search, so the price never depends on which step answered. A social page costs 2. In the Get contacts box, each verified email found costs 2.5 credits, and phone numbers are checked at 1 credit per 5 numbers, with numbers checked in the last 30 days free. These are the standard rates. The box and the button always show the price you will actually pay, and “Plan & credits” shows your own price list."),
        {
          type: "callout",
          tone: "note",
          title: "You are not charged twice",
          text: "The same lookup for the same company is not charged twice within 90 days, however often you press it. A double click or a second tab is free. If we cannot take the credit, nothing found is kept and nothing is charged.",
        },
        p("When a lookup finds close matches but is not sure, “Check matches” opens a box with the closest ones. Showing suggestions is free. You are charged when you choose one. You can also add details such as a town and search again."),
        p("A miss is remembered. If we looked a short while ago and found nothing, the button says “Nothing confirmed · search again”, and a repeat inside that window searches nothing and charges nothing. Add details, or try again later."),
        p("The Get contacts box says when a source is “not set up yet, so skipped”. Companies that look closed are not searched and not charged. A company you opened with Reveal does not need Get contacts for that detail."),
      ],
    },
    {
      id: "company-profile",
      heading: "A company’s profile panel",
      blocks: [
        p("Click a company to open its panel on the right. It reads the register as soon as it opens, which is free, and shows these parts."),
        {
          type: "table",
          headers: ["Part", "What it shows"],
          rows: [
            ["People on the public register (verified)", "Directors and officers, with role, years in the role, and what the register publishes such as nationality and where they live. “Left in the last year” lists recent leavers."],
            ["Who owns or controls it (verified)", "People with significant control, with the nature of that control and since when."],
            ["Contact details", "The website, phone and email we hold, with a label for how far to trust them."],
            ["Found on the web", "What a web search found, always labelled as web and kept apart from register facts."],
          ],
        },
        p("The panel also has “Open page”, “Favourite”, “Save”, and “Save & call”. “Note” lets you leave a note that everyone in your organisation sees. Registry facts are labelled “(verified)”. Anything from the web is labelled so you never mistake a web guess for a register fact."),
      ],
    },
    {
      id: "saved-searches",
      heading: "Saved searches and weekly runs",
      blocks: [
        p("Press “Saved searches” on the Companies tab to keep a search. A saved search becomes a list that fills itself."),
        {
          type: "steps",
          items: [
            "Set filters with an industry, a place or a reason to get in touch. A search with none of those cannot be saved. The box says “Set an industry, a place or a reason to get in touch first.”",
            "Open “Saved searches” and type a name under “Save this search as a list”, for example Leeds accountants. The name can be up to 80 characters.",
            "Leave “Keep it updated weekly” ticked, or untick it.",
            "Press “Save the search and make the list”. We run it once and fill the list. The message says how many companies went in.",
          ],
        },
        p("Each saved search remembers which companies it has already shown. A run adds only new ones, so nothing is added twice. A run adds up to 200 companies at a time. Runs are free: saving a company from the register costs no credits."),
        {
          type: "table",
          headers: ["Control", "What it does"],
          rows: [
            ["The name", "Click to load those filters back into the panel and run the search."],
            ["Run now", "Runs it now and adds new companies to its list. The message says how many."],
            ["Weekly", "Tick to have it run itself. A weekly search is checked at most once a day and runs when its last run was 7 or more days ago. We then tell your admins what was added, with a link to the list."],
            ["Delete", "Forgets the search. The list it filled stays."],
          ],
        },
        p("Under each search you see its last run, such as “Updates weekly. Last run 3 Nov, 12 new.” or “Runs when you ask.” You can keep up to 50 saved searches."),
      ],
    },
    {
      id: "common-problems",
      heading: "Common problems",
      blocks: [
        {
          type: "table",
          headers: ["What you see", "What it means and what to do"],
          rows: [
            ["“No companies match these filters”", "Nothing fits. Try a wider town, a broader industry word, or tick “Include closed / dissolved”. Check “Leave out” and “Exclusion list” for items that are too wide."],
            ["Fewer results than you expected", "The register shows active companies only by default, hides schools and community places, and matches a trade’s main activity. Tick “Include closed / dissolved”, “Include schools & community places” or “Include side activities” as needed."],
            ["“The search didn’t finish. Try again.”", "The search timed out or the server was busy. Press “Try again”. Add a town to make it lighter."],
            ["“Did you mean …?”", "The town you typed is not on the register but a near spelling is. Press the button to use it."],
            ["A company’s website is blank with the word “Held”", "We hold a website for it. Press “Reveal” to open it. It is free."],
            ["“Nothing confirmed · search again”", "A web search found nothing it could tie to that company. It is not a promise that there is none. Add details and search again later. You were not charged."],
            ["“Newest first · ranking not run yet”", "The register has not been ranked yet. Results are still correct but not best-first."],
            ["“Companies without a usable postcode aren’t on the map”", "They are in the List view. Pins use each company’s registered postcode."],
            ["“No people on file”", "Press “Find people at the next N companies” on the People tab. Reading the register is free."],
            ["Can’t save a search", "A saved search needs an industry, a place or a reason to get in touch."],
          ],
        },
        p("If something still looks wrong, open “Troubleshooting” in the guides, or ask the AI Assistant to explain what a filter did."),
      ],
    },
  ],
};
