const p = (text) => ({ type: "paragraph", text });

export const socialMediaDoc = {
  id: "social-media",
  path: "/help/social/media",
  title: "Media & Asset Library",
  summary: "Manage corporate visual assets, generate high-definition AI social graphics, format imagery across social aspect ratios, and organize video clips.",
  sections: [
    {
      id: "overview",
      heading: "Overview of the Media Library",
      blocks: [
        p("Visual content generates up to 3x higher engagement than plain text posts across all major professional and commercial social networks. The Media Library in Social acts as your organization's central visual repository, organizing corporate photography, product graphics, brand identity logos, and AI-generated illustrations."),
        p("You can upload existing graphic assets directly from your computer or use the built-in AI visual engine to create bespoke, copyright-free imagery directly from post concepts and campaign themes."),
        p("Every uploaded and generated asset is automatically cataloged with resolution metadata, file size attributes, and associated channel tags so content creators can find the right creative collateral in seconds."),
      ],
    },
    {
      id: "ai-visual-generator",
      heading: "Generating AI Social Imagery",
      blocks: [
        p("Whenever a post is outlined, Outreach can automatically generate tailored high-definition artwork to accompany the caption:"),
        {
          type: "steps",
          items: [
            "Context-Aware Prompts: The AI analyzes the post topic (e.g. 'UK commercial freight logistics' or 'Automated payroll compliance') and crafts a high-fidelity visual prompt focusing on professional, modern scenes.",
            "Visual Styles: Choose from curated visual themes: Clean Executive 3D Render, Editorial Photography, Minimalist Vector Illustration, or Modern Technical Diagram.",
            "Aspect Ratio Optimization: Automatically generates square (1:1) assets for LinkedIn and Instagram feeds, portrait (4:5) for mobile browsing, or landscape (16:9) for X and Facebook.",
            "Instant Regenerate: If you want a different visual angle or compositional perspective, click 'Regenerate Image' to create an alternative scene within seconds.",
          ],
        },
      ],
    },
    {
      id: "asset-storage",
      heading: "Managing Brand Assets & Logos",
      blocks: [
        p("Keep your official corporate collateral organized in the Pictures & Videos library:"),
        {
          type: "table",
          headers: ["Asset Category", "Recommended Format", "How It Is Used"],
          rows: [
            ["Primary Brand Logo", "Transparent PNG / SVG", "Automatically placed as a subtle watermark on generated graphics."],
            ["Product Screenshots", "High-res PNG (1080p+)", "Used in feature announcement posts and customer walkthrough tutorials."],
            ["Executive Portraits", "Clean JPEG / PNG", "Paired with founder updates, quote cards, and thought-leadership articles."],
            ["Event Photography", "Landscape JPEG", "Attached to conference recaps, awards celebrations, and community news."],
          ],
        },
      ],
    },
    {
      id: "video-clips",
      heading: "Video Clips & Video Previews",
      blocks: [
        p("Video content commands prime algorithmic distribution across LinkedIn, Instagram Reels, and Facebook feeds:"),
        {
          type: "steps",
          items: [
            "Video Upload: Upload MP4 or MOV clips directly into the Media tab. Files up to 250MB are supported with adaptive compression.",
            "Thumbnail Selection: Choose an engaging keyframe from the video timeline to serve as the preview poster before playback begins.",
            "Caption Formatting: The composer automatically adjusts character limits to ensure the text complements video playback on mobile screens.",
          ],
        },
      ],
    },
    {
      id: "bulk-importing",
      heading: "Bulk Media Importing & CSV Ingestion",
      blocks: [
        p("If your marketing team prepares monthly campaigns in spreadsheets or external cloud storage repositories:"),
        {
          type: "steps",
          items: [
            "Open 'Import posts' under the Library section.",
            "Upload your CSV containing columns for Date, Time, Channel, Caption, and Image URL.",
            "The system ingests the external media links, verifies file accessibility, and places the completed drafts onto your post calendar ready for review.",
          ],
        },
      ],
    },
  ],
};
