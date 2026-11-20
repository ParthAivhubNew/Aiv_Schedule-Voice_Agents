export const leadsFormsDoc = {
  id: "leads-forms",
  path: "/help/leads/forms",
  title: "Forms",
  summary: "Build a web form, share its link or embed it on your site, and turn every answer with a working email into a lead.",
  sections: [
    {
      id: "what-a-form-is",
      heading: "What an inbound form is",
      blocks: [
        {
          type: "paragraph",
          text: "An inbound form is a short web form that visitors fill in. It asks for a name and an email, plus anything else you add. Each answer with a working email address becomes a company in your leads and lands in the list you choose. From there it can join a journey like any other lead.",
        },
        {
          type: "paragraph",
          text: "Open \"Forms\" in the left menu, under Inbound. The page lists your forms with their status (\"Draft\", \"Published\" or \"Published, edits not live\"), the number of answers and when each was last changed. You can keep up to 100 forms.",
        },
      ],
    },
    {
      id: "creating-a-form",
      heading: "Creating a form",
      blocks: [
        {
          type: "steps",
          items: [
            "Press \"New form\", or \"Create your first form\" if you have none. Name it, for example \"Contact us\", and press \"Create form\".",
            "On the \"Fields\" tab, add the questions you need and put them in order.",
            "On the \"Settings\" tab, choose where new leads go and what visitors see after they send.",
            "Press \"Save\", then \"Publish\". The link is live as soon as you publish.",
            "Use the \"Share\" tab to copy the link or the embed code.",
          ],
        },
        {
          type: "paragraph",
          text: "A form can hold up to 20 fields. The field types are \"Name\", \"Email\", \"Phone\", \"Short text\", \"Dropdown\" and \"Checkbox\". Every form has an email field, and it is always required and cannot be removed. Click a field to change its label and placeholder, to mark it \"Required\", and to set what it is saved as. A dropdown takes its options one per line, up to 30.",
        },
        {
          type: "paragraph",
          text: "\"Save the answer as\" decides where an answer lands on the lead: \"Contact name\", \"Email\", \"Phone\", \"Company name\", \"Website\", \"Job title\", \"Industry\", \"Region\" or \"Notes\". Choose \"Keep as the form's own question\" for a question that has no matching place on a lead. The answer is then kept with the form's answers. A live preview sits beside the fields.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Edits go live when you publish",
          text: "Saving keeps your changes private. The live form changes only when you press \"Publish changes\". Until then the status reads \"Published, edits not live\". \"Unpublish\" takes the link offline, and you can publish again later.",
        },
      ],
    },
    {
      id: "link-and-embedding",
      heading: "The public link and embedding",
      blocks: [
        {
          type: "paragraph",
          text: "Once published, the \"Share\" tab gives you two things, each with a \"Copy\" button. \"Link to the form page\" is a page we host. Send it in an email or put it behind a button. \"iframe for your website\" is a snippet you paste into your own web page, so the form shows inside it.",
        },
        {
          type: "paragraph",
          text: "The link is public. Anyone who has it can send an answer. If it is misused, press \"Make a new link\". The old link and any iframe that uses it stop working at once.",
        },
        {
          type: "paragraph",
          text: "Under \"Settings\", \"Websites that can embed the form in a frame\" limits which sites may show your form inside a frame, for example acme.com. Leave it empty to allow any site. This controls only where the form can be shown. It does not stop anyone sending answers to your link, and your own hosted link always works.",
        },
      ],
    },
    {
      id: "where-answers-go",
      heading: "Where answers go",
      blocks: [
        {
          type: "paragraph",
          text: "In \"Settings\", \"Add new leads to this list\" chooses the list. Pick one of your lists, or let the form create one. A new list is named \"Web form leads\" unless you give it another name.",
        },
        {
          type: "paragraph",
          text: "If the person's email already belongs to a company you have saved, the answer is attached to that company and no duplicate is made. If it is new, a company is created from the answer. When the form has no website or company name, the company is named from the email domain. An email at Gmail or another free mailbox gives no domain, so it is named from the person's own name.",
        },
        {
          type: "paragraph",
          text: "Someone who has already opted out is never put back on a list, whoever approves the answer. That answer is blocked with the reason \"This person has opted out\".",
        },
        {
          type: "paragraph",
          text: "\"Message after sending\" is the text visitors see once they send the form. If you leave it empty they see \"Thanks, we got your details.\"",
        },
      ],
    },
    {
      id: "pending-and-approve",
      heading: "Checking, pending and approval",
      blocks: [
        {
          type: "paragraph",
          text: "Anyone on the internet can send an answer to a published form, so no answer goes straight into your leads. Each one first waits as \"Checking\". A quick automatic review then looks at one thing: whether the email's domain can receive mail.",
        },
        {
          type: "table",
          headers: ["Status on the \"Answers\" tab", "What it means"],
          rows: [
            ["Checking", "The review has not finished. If the check could not get an answer, the answer stays here and is tried again about every five minutes for up to seven days."],
            ["Saved as a lead", "The domain can receive mail, or you approved it. The company is in the list you chose."],
            ["Blocked", "The domain cannot receive mail, or the person has opted out. The reason shows beside the status."],
          ],
        },
        {
          type: "paragraph",
          text: "The \"Answers\" tab lists each answer with when it came in, the email, the other answers and the status. \"Save as lead\" approves an answer yourself, including one that was blocked. \"Block\" rejects an answer that is still checking. \"Open lead\" opens the saved company.",
        },
      ],
    },
    {
      id: "consent-and-privacy",
      heading: "Consent text and the privacy line",
      blocks: [
        {
          type: "paragraph",
          text: "\"Privacy line under the form\" is the sentence shown under the \"Submit\" button. If you leave it empty the form says \"By sending this form you agree that we may contact you about your enquiry.\" Change it to match how you will really use the answer.",
        },
        {
          type: "paragraph",
          text: "The wording that was shown and the time it was shown are saved with each answer, together with the version of the form it was sent from. That gives you a record of what each person was told.",
        },
        {
          type: "callout",
          tone: "warning",
          title: "Keep the promise",
          text: "The privacy line is a promise to the visitor. Only contact people in the ways it describes.",
        },
      ],
    },
    {
      id: "spam-protection",
      heading: "Spam protection and limits",
      blocks: [
        {
          type: "table",
          headers: ["Protection", "What it does"],
          rows: [
            ["Plain text only", "Markup and control characters are stripped from every answer. Text that a spreadsheet would run as a formula is neutralised."],
            ["Known fields only", "An answer with a field that is not part of the form is refused. An email, phone number or dropdown choice that does not look right is refused."],
            ["A hidden field", "A field real visitors never see. If a bot fills it in, the form looks as if it worked but nothing is stored."],
            ["Rate limits", "Too many answers in a short time from one address, or from all visitors to one form, get \"Too many answers just now. Try again in a moment.\""],
            ["Most answers accepted in 24 hours", "Set in \"Settings\", from 1 to 5000, default 200. Past it, the form says it is not taking answers right now."],
            ["One a day per person", "The same email sending the form twice in one day makes one row, not two."],
          ],
        },
        {
          type: "paragraph",
          text: "Two more settings narrow who can send. \"Ask for a work email\" refuses Gmail, Outlook and other free mailboxes. \"Only accept these email domains\" accepts only the domains you list, for example acme.co.uk, and leaving it empty accepts any.",
        },
      ],
    },
    {
      id: "personal-links-in-emails",
      heading: "Personal links in journey emails",
      blocks: [
        {
          type: "paragraph",
          text: "In a journey email step you can add \"Send a form in this email\" and pick \"Insert form link\". This puts a tag such as {{form_link:ID}} into the email. When the email is sent, each person gets their own link to the form. It is only offered for published forms. If a form is not published when the email is due, no link is written, so nobody gets a broken one.",
        },
        {
          type: "paragraph",
          text: "A personal link does these things:",
        },
        {
          type: "steps",
          items: [
            "It fills in the person's details on the form and says who sent it.",
            "It works for 30 days. The link is signed, so changing it makes it stop working.",
            "It allows one answer per person per link. A second try shows \"This form has already been sent from this link. Thank you.\"",
            "It skips the work-email and allowed-domain rules, because the email came from you.",
            "The answer is saved onto the lead the email was sent to, filling only details that are empty, and it needs no review.",
            "It ends their journey, unless you switched off \"Send back a form\" in the journey's rules.",
          ],
        },
        {
          type: "paragraph",
          text: "On a \"Phone\" field, or a field saved as \"Website\", you can tick \"Add this answer to the company's details\". The answer is then added to the company's shared record, shown as given by the business and not verified. It happens only through a personal link from your email, and the form tells the person. The first value given is kept, and a later one never overwrites it.",
        },
        {
          type: "callout",
          tone: "note",
          title: "Forwarded links",
          text: "Anyone who gets a personal link can use it, so treat what comes back through it as unverified.",
        },
      ],
    },
  ],
};
