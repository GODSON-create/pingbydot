// BUILD AFRICA CHALLENGE — Visitor-First Programme Data

window.SPEC_DATA = {
  meta: {
    programme: "Build Africa Challenge",
    launchTarget: "December 2026",
    headline: "Have an idea? Let's help you build it.",
    subheadline: "Join Ping. Share your idea. Learn on DOT. If selected, build with GRIOT AI.",
    oneYearObjective: "Our one-year objective is to bring 100 million people into one connected builder network."
  },

  howItWorks: [
    {
      step: 1,
      title: "Join Ping and verify your account.",
      description: "Create your primary builder profile on Ping, complete account verification, and receive your permanent DOT ID.",
      product: "Ping"
    },
    {
      step: 2,
      title: "Share your idea and participate.",
      description: "Register for the Challenge using your Ping profile, submit your idea, and engage with the builder community.",
      product: "Ping"
    },
    {
      step: 3,
      title: "Earn eligible DOT credits progressively.",
      description: "Unlock learning credits step by step as you verify your account, complete learning milestones, and demonstrate project progress.",
      product: "Ping → DOT"
    },
    {
      step: 4,
      title: "Learn and develop on DOT.",
      description: "Open DOT with your linked identity, activate your credit wallet, and take structured courses, learning paths, and assessments.",
      product: "DOT"
    },
    {
      step: 5,
      title: "Qualify for GRIOT AI through eligibility and merit-based selection.",
      description: "Meet programme eligibility requirements and pass merit-based review to earn access to the GRIOT AI execution workspace.",
      product: "GRIOT AI"
    },
    {
      step: 6,
      title: "Build your project and share progress on Ping.",
      description: "Structure your project, complete tasks and milestones in GRIOT AI, and publish your approved progress back on Ping.",
      product: "GRIOT AI → Ping"
    }
  ],

  products: [
    {
      id: "ping",
      name: "Ping",
      tagline: "PING — JOIN AND CONNECT",
      summary: "Discover opportunities, join communities, share ideas, connect with builders and publish progress.",
      networkRole: "Ping connects people and distributes opportunities.",
      retentionDrivers: "Discovery, communities, connections, opportunities and progress.",
      liveUrl: "https://justping.lovable.app/",
      liveLabel: "justping.lovable.app",
      surface: "obsidian",
      highlights: [
        "Discover opportunities and join builder communities",
        "Create your primary builder identity and verify your account",
        "Share ideas and connect with founders and collaborators",
        "Publish weekly progress and validated milestones"
      ],
      quickRoutes: [
        { label: "Home", url: "https://justping.lovable.app/" },
        { label: "Explore", url: "https://justping.lovable.app/explore" },
        { label: "Spotlight", url: "https://justping.lovable.app/spotlight" },
        { label: "Hubs", url: "https://justping.lovable.app/hubs" }
      ]
    },
    {
      id: "dot",
      name: "DOT",
      tagline: "DOT — LEARN AND DEVELOP",
      summary: "Access courses, learning paths, resources, learning progress, a credit wallet and qualifying perks.",
      networkRole: "DOT develops people's knowledge and capabilities.",
      retentionDrivers: "Courses, learning paths, assessments, resources and learning progress.",
      liveUrl: "https://dotlive.lovable.app/",
      liveLabel: "dotlive.lovable.app",
      surface: "stone",
      highlights: [
        "Structured learning paths from Idea to Venture through Capital Readiness",
        "Courses, assessments, guides, templates, and practical resources",
        "Track your learning progress and verified skill achievements",
        "Manage your permanent DOT ID, credit wallet, and qualifying perks"
      ],
      quickRoutes: [
        { label: "Home", url: "https://dotlive.lovable.app/" },
        { label: "Learn", url: "https://dotlive.lovable.app/learn" },
        { label: "Library", url: "https://dotlive.lovable.app/library" },
        { label: "Wallet", url: "https://dotlive.lovable.app/wallet" },
        { label: "Perks", url: "https://dotlive.lovable.app/perks" }
      ]
    },
    {
      id: "griot",
      name: "GRIOT AI",
      tagline: "GRIOT AI — PLAN AND BUILD",
      summary: "A project execution workspace that helps selected builders structure projects, organise tasks, schedule work, track milestones and improve execution.",
      networkRole: "GRIOT AI helps people turn knowledge and ideas into execution.",
      retentionDrivers: "Project workspaces, tasks, schedules, milestones and execution history.",
      liveUrl: null,
      liveLabel: "Interactive Workspace Preview",
      surface: "emerald",
      highlights: [
        "Structure projects from an idea into a clear, actionable blueprint",
        "Organise tasks, schedule work, and track real execution history",
        "Submit work for review and receive targeted DOT learning recommendations",
        "Publish approved project milestones back to Ping when you choose"
      ],
      quickRoutes: [
        { label: "Project Blueprint", view: "blueprint" },
        { label: "Tasks & Schedule", view: "tasks" },
        { label: "DOT Learning Sync", view: "learning" },
        { label: "Publish to Ping", view: "publish" }
      ]
    }
  ],

  networkStrategy: {
    headline: "Three connected products, not isolated applications",
    summary: "Identity, learning progress, project activity and approved progress sharing connect the experience. Each product remains independently useful.",
    pillars: [
      {
        product: "Ping",
        role: "Connects people and distributes opportunities",
        detail: "Maintains your primary builder network identity, community connections, idea submissions, and public progress updates."
      },
      {
        product: "DOT",
        role: "Develops people's knowledge and capabilities",
        detail: "Maintains your permanent DOT ID, authoritative learning-credit wallet, structured learning paths, assessments, and qualifying perks."
      },
      {
        product: "GRIOT AI",
        role: "Helps people turn knowledge and ideas into execution",
        detail: "Uses your linked identity and learning context to guide project planning, task scheduling, milestone review, and execution."
      }
    ],
    bridges: [
      "Shared Identity: Sign up once on Ping and receive one permanent DOT ID across the network.",
      "Learning Progress: Courses and assessments completed on DOT support your Challenge journey and project readiness.",
      "Project Activity: GRIOT AI identifies knowledge gaps during execution and links directly to relevant DOT lessons.",
      "Approved Progress Sharing: Completed milestones in GRIOT AI publish back to Ping only with your explicit approval."
    ]
  },

  retentionAndSuccess: {
    retentionHeadline: "Why builders return every week",
    retentionItems: [
      {
        product: "Ping",
        focus: "Community & Visibility",
        features: "Discovery, communities, connections, opportunities and progress."
      },
      {
        product: "DOT",
        focus: "Capability & Growth",
        features: "Courses, learning paths, assessments, resources and learning progress."
      },
      {
        product: "GRIOT AI",
        focus: "Structured Execution",
        features: "Project workspaces, tasks, schedules, milestones and execution history."
      }
    ],
    successHeadline: "How we define programme success",
    successMetrics: [
      {
        label: "Reach",
        value: "100M",
        detail: "100 million people brought into one connected builder network over one year."
      },
      {
        label: "Connected Identity",
        value: "1 DOT ID",
        detail: "One verified builder identity seamlessly linking Ping, DOT, and GRIOT AI."
      },
      {
        label: "Active Learning",
        value: "5 Paths",
        detail: "Practical venture learning from Idea to Venture through Capital Readiness on DOT."
      },
      {
        label: "Real Execution",
        value: "Merit-Based",
        detail: "Tangible project milestones built, reviewed, and shared across the network."
      }
    ]
  },

  challengePillars: {
    participation: {
      title: "Participation Requirements",
      summary: "The Build Africa Challenge is a development programme for builders turning ideas into real projects.",
      points: [
        "Join Ping with a single account that works across Ping, DOT, and GRIOT AI.",
        "Complete account verification to receive your permanent DOT ID.",
        "Share your idea and participate consistently.",
        "You can still use Ping without DOT, learn on DOT without joining the Challenge, and use GRIOT AI independently when granted access."
      ]
    },
    verification: {
      title: "Account Verification Tiers",
      summary: "Platform verification confirms your builder identity on Ping and triggers permanent DOT ID issuance.",
      tiers: [
        { name: "Standard", price: "Free", detail: "Verified Ping identity and permanent DOT ID issuance" },
        { name: "Builder Plus", price: "₦3,000", detail: "Verified identity with expanded programme eligibility" },
        { name: "Builder Pro", price: "₦30,000", detail: "Full professional builder verification tier" }
      ]
    },
    rewards: {
      title: "Progressive, Tiered DOT Credit Rewards",
      summary: "Participants earn eligible DOT credits progressively as they meet real milestones. DOT credits support learning and development on DOT—they are not cash, investment capital, or withdrawable funds.",
      tiers: [
        { tier: "Tier 1", name: "Verified Builder", condition: "Verified Ping account, DOT ID issued, and qualifying active participation" },
        { tier: "Tier 2", name: "Learning Builder", condition: "Required DOT learning milestones completed" },
        { tier: "Tier 3", name: "Active Builder", condition: "Meaningful project progress and evidence submitted" },
        { tier: "Tier 4", name: "Demonstrating Builder", condition: "Approved project milestone or deliverable" },
        { tier: "Tier 5", name: "Exceptional Builder", condition: "Merit-based programme review and additional approved achievement" }
      ]
    },
    griotSelection: {
      title: "GRIOT AI Eligibility & Merit-Based Selection",
      summary: "Access to GRIOT AI is not guaranteed to every participant and cannot be purchased. Builders qualify through two gates:",
      gates: [
        { gate: "Gate 1 — Programme Eligibility", detail: "Verified Ping account, linked DOT ID, active idea submission, and required DOT learning progress." },
        { gate: "Gate 2 — Merit-Based Selection", detail: "Evaluation of idea quality, consistency, submitted evidence, and execution readiness." }
      ]
    },
    spotlight: {
      title: "Editorial Spotlight",
      summary: "Spotlight recognises standout builders on Ping through merit-based editorial selection. There is no 'Apply for Spotlight' button.",
      criteria: [
        "Quality and originality of the idea",
        "Evidence of real progress and consistency",
        "Meaningful impact and execution quality",
        "Authentic community engagement (likes alone do not determine selection)"
      ]
    }
  },

  roadmap: [
    {
      step: 1,
      title: "Connect Ping and DOT identities",
      description: "Enable single sign-in so verified Ping members automatically receive their permanent DOT ID and can claim their account safely."
    },
    {
      step: 2,
      title: "Make DOT Learn and its credit wallet ready",
      description: "Put learning paths and courses front and centre on DOT, connected to the credit wallet and qualifying perks."
    },
    {
      step: 3,
      title: "Build the GRIOT AI project workspace",
      description: "Deliver the Project Architect, task planner, work review tools, and DOT learning recommendations for selected builders."
    },
    {
      step: 4,
      title: "Connect the complete Challenge journey",
      description: "Link idea submissions, progressive credit rewards, learning milestones, and approved progress updates across all three products."
    },
    {
      step: 5,
      title: "Test and launch",
      description: "Verify the end-to-end builder experience and launch the Build Africa Challenge in December 2026."
    }
  ],

  faqs: [
    {
      q: "Do I need three separate accounts for Ping, DOT, and GRIOT AI?",
      a: "No. You sign up once on Ping. When you verify your account, you receive a permanent DOT ID that connects your learning on DOT and, if selected, your workspace in GRIOT AI."
    },
    {
      q: "Can I use Ping or learn on DOT without joining the Build Africa Challenge?",
      a: "Yes. Each product remains independently useful. You can connect with the community on Ping or take courses on DOT at any time without participating in the Challenge."
    },
    {
      q: "Are DOT credits cash or withdrawable money?",
      a: "No. DOT credits are learning and development credits used inside DOT for courses, learning paths, resources, and eligible perks. They cannot be withdrawn as cash."
    },
    {
      q: "Does every participant automatically get access to GRIOT AI?",
      a: "No. GRIOT AI access requires meeting programme eligibility and passing a merit-based selection review. No one can buy their way into GRIOT AI selection."
    },
    {
      q: "How do I get featured on Ping Spotlight?",
      a: "Spotlight is editorially selected based on the quality of your idea, consistent evidence of progress, and execution quality. Users do not apply for Spotlight."
    },
    {
      q: "Does GRIOT AI publish my project work to Ping automatically?",
      a: "Never. Your project plans, working documents, and AI conversations remain private. You choose which milestones or updates to share publicly on Ping."
    }
  ]
};
