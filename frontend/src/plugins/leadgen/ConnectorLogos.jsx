import React from "react";

// Official vector logos for Data & AI Connectors
export function CompaniesHouseLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#1D70B8" />
      {/* Crown emblem */}
      <path
        d="M8 21.5h16v1.5H8v-1.5zm15-9.5l-2.5 4.5-4.5-4-4.5 4L9 12l1 7h12l1-7z"
        fill="#FFFFFF"
      />
      <circle cx="16" cy="10" r="1.2" fill="#FFFFFF" />
      <circle cx="9" cy="10" r="1.2" fill="#FFFFFF" />
      <circle cx="23" cy="10" r="1.2" fill="#FFFFFF" />
      <path d="M11 20h10v.8H11z" fill="#1D70B8" />
    </svg>
  );
}

export function FsaLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#00703C" />
      {/* Shield and check mark */}
      <path
        d="M16 6.5l8 3.5v6.5c0 5-3.5 9-8 10.5-4.5-1.5-8-5.5-8-10.5V10l8-3.5z"
        fill="#FFFFFF"
        fillOpacity="0.2"
      />
      <path
        d="M13.5 16.5l-2.5-2.5-1.5 1.5 4 4 8-8-1.5-1.5-6.5 6.5z"
        fill="#FFFFFF"
      />
      <text x="16" y="27" textAnchor="middle" fill="#FFFFFF" fontSize="6" fontWeight="bold" fontFamily="sans-serif">
        FSA
      </text>
    </svg>
  );
}

export function CqcLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#6E2585" />
      {/* Care Quality Commission quad mark */}
      <circle cx="12" cy="12" r="3" fill="#00A599" />
      <circle cx="20" cy="12" r="3" fill="#FFFFFF" />
      <circle cx="12" cy="20" r="3" fill="#FFFFFF" />
      <circle cx="20" cy="20" r="3" fill="#FFB81C" />
    </svg>
  );
}

export function TpsLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#008542" />
      {/* Phone receiver and shield */}
      <path
        d="M21.5 18.2c-1.2 0-2.4-.2-3.5-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.5-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.3-.6-3.5 0-.6-.4-1-1-1H6.2c-.6 0-1 .4-1 1 0 8.8 7.2 16 16 16 .6 0 1-.4 1-1v-2.8c0-.6-.4-.8-.7-.8z"
        fill="#FFFFFF"
      />
      <circle cx="22" cy="10" r="4" fill="#FFFFFF" />
      <path d="M20.5 10l1 1 2.5-2.5" stroke="#008542" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OrdnanceSurveyLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#002E6D" />
      {/* OS compass & geometric contours */}
      <circle cx="16" cy="16" r="8" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M16 6v20M6 16h20" stroke="#FFFFFF" strokeWidth="1.2" />
      <polygon points="16,9 18.5,16 16,14.5 13.5,16" fill="#E31B23" />
      <polygon points="16,23 18.5,16 16,17.5 13.5,16" fill="#FFFFFF" />
    </svg>
  );
}

export function SalesforceLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#00A1E0" />
      <path
        d="M10.005 5.416c.75-.796 1.845-1.306 3.046-1.306 1.56 0 2.954.9 3.689 2.205.63-.3 1.35-.45 2.101-.45 2.849 0 5.159 2.34 5.159 5.22s-2.311 5.22-5.176 5.22c-.345 0-.689-.044-1.02-.104-.645 1.17-1.875 1.95-3.3 1.95-.6 0-1.155-.15-1.65-.375-.78 1.485-2.34 2.475-4.125 2.475-2.61 0-4.725-2.115-4.725-4.725 0-.585.105-1.14.3-1.665C1.65 14.736.75 13.251.75 11.551c0-2.475 1.905-4.5 4.35-4.65.66-1.5 2.175-2.55 3.905-2.485z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function HubspotLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#FFF2EE" />
      <path
        fill="#FF7A59"
        d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"
      />
    </svg>
  );
}

export function DynamicsLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#F0F4F8" />
      {/* Microsoft Dynamics 365 symbol */}
      <path d="M4 4h7v7H4V4z" fill="#002050" />
      <path d="M13 4h7v7h-7V4z" fill="#0078D4" />
      <path d="M4 13h7v7H4v-7z" fill="#0078D4" />
      <path d="M13 13h7v7h-7v-7z" fill="#28A8EA" />
    </svg>
  );
}

export function ZohoLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
      {/* Zoho colorful interlocking blocks */}
      <rect x="5" y="8" width="9" height="9" rx="2" fill="#E42528" />
      <rect x="18" y="8" width="9" height="9" rx="2" fill="#2BA84A" />
      <rect x="5" y="19" width="9" height="9" rx="2" fill="#0078BD" />
      <rect x="18" y="19" width="9" height="9" rx="2" fill="#F8B122" />
    </svg>
  );
}

export function PipedriveLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#04442B" />
      <circle cx="12" cy="10" r="4.2" fill="#FFFFFF" />
      <path d="M7.8 10v9.5h3.6V10H7.8z" fill="#FFFFFF" />
    </svg>
  );
}

export function BigQueryLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#E8F0FE" />
      <path
        d="M12 3l7.5 4.3v8.7L12 20.3 4.5 16V7.3L12 3z"
        stroke="#4285F4"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11.5" r="3.5" fill="#4285F4" />
      <path d="M14.5 14l3.5 3.5" stroke="#4285F4" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PostgresLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#EBF3F9" />
      <path
        d="M21 12.5c-.3-.4-1.9-2.3-3.8-2.4-.4 0-.8.1-1.2.4l-1.7 1.2c-.2.2-.5.2-.8.1l-1.9-.5c-.3-.1-.6-.4-.7-.7l-.7-2.1c-.1-.3-.4-.6-.8-.7l-2.2-.3c-.3 0-.6-.2-.9-.6l-1-2c-.2-.3-.6-.6-1-.6L4.5 4.5"
        stroke="#336791"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="7" stroke="#336791" strokeWidth="1.3" />
      <circle cx="9.5" cy="10.5" r="1" fill="#336791" />
    </svg>
  );
}

export function SnowflakeLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#E6F7FD" />
      <path
        d="M12 2v19.5M3.5 7l17 9.5M3.5 16.5l17-9.5M8 4.5l4 3.5 4-3.5M8 19.5l4-3.5 4 3.5M4.5 11l4.5 1-2.5 4M19.5 11l-4.5 1 2.5 4"
        stroke="#29B5E8"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="#29B5E8" />
    </svg>
  );
}

export function AwsS3Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#FFF3E0" />
      {/* AWS S3 Bucket emblem */}
      <path
        d="M12 3l7 3.5v9L12 19l-7-3.5v-9L12 3z"
        stroke="#E65100"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 7.5l4 2v4l-4 2-4-2v-4l4-2z" fill="#FF9900" />
    </svg>
  );
}

export function AirtableLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#F8FAFC" />
      <path
        d="M11.992 2.5c-.434 0-.87.086-1.28.257L2.5 6.1c-.503.208-.49.908.012 1.116l8.4 3.3a2.5 2.5 0 0 0 2.1 0l8.4-3.3c.5-.2.5-.9 0-1.1L13.2 2.75a2.5 2.5 0 0 0-1.2-.25z"
        fill="#FCB400"
      />
      <path
        d="M21.5 8.5l-8.5 3.3v7.7l8.5-3.8c.4-.2.5-.5.5-.9V9c0-.4-.3-.6-.5-.5z"
        fill="#18BFFF"
      />
      <path
        d="M2.5 8.5L11 12v7.7L2.5 16c-.4-.2-.5-.5-.5-.9V9c0-.4.3-.6.5-.5z"
        fill="#F82B60"
      />
    </svg>
  );
}

export function AzureLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#EFF6FC" />
      <path
        d="M12.8 4.2L5.5 17.5h4.2l2.3-4.5 4.8 6.5H21L12.8 4.2z"
        fill="#0078D4"
      />
      <path
        d="M11.5 14.5l-2.8 5H3.5l5.2-9.5 2.8 4.5z"
        fill="#50E6FF"
      />
    </svg>
  );
}

export function GoogleCloudLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#FFFFFF" stroke="#E2E8F0" />
      <path d="M14.5 8.5a3.5 3.5 0 0 0-5.8-1 4.5 4.5 0 0 0-2.2 4.2 4 4 0 0 0 3.5 4.3h8a3.5 3.5 0 0 0 .5-7 3.5 3.5 0 0 0-4-.5z" fill="#4285F4" />
      <path d="M12 12l2.5 2.5h-5L12 12z" fill="#34A853" />
    </svg>
  );
}

export function CsvLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#107C41" />
      <path d="M6 5h8l4 4v10H6V5z" fill="#FFFFFF" fillOpacity="0.2" />
      <text x="12" y="16" textAnchor="middle" fill="#FFFFFF" fontSize="6.5" fontWeight="bold" fontFamily="sans-serif">
        .CSV
      </text>
    </svg>
  );
}

export function WebCrawlerLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#4338CA" />
      <circle cx="12" cy="12" r="5" stroke="#FFFFFF" strokeWidth="1.5" />
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.8 2.8M14.7 14.7l2.8 2.8M6.5 17.5l2.8-2.8M14.7 9.3l2.8-2.8" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function LeadFitLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#7C3AED" />
      <circle cx="12" cy="12" r="7" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="3 2" />
      <circle cx="12" cy="12" r="3.5" fill="#FFFFFF" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function JourneyAiLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#2563EB" />
      <path d="M4 7l8 5 8-5v10H4V7z" stroke="#FFFFFF" strokeWidth="1.5" fill="#FFFFFF" fillOpacity="0.2" />
      <path d="M16 4l2 2-6 6-3-3" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DossierAiLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#D97706" />
      <rect x="5" y="4" width="14" height="16" rx="2" stroke="#FFFFFF" strokeWidth="1.5" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ClassifierAiLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#0891B2" />
      <circle cx="7" cy="8" r="2.5" fill="#FFFFFF" />
      <circle cx="17" cy="8" r="2.5" fill="#FFFFFF" />
      <circle cx="12" cy="16" r="2.5" fill="#FFFFFF" />
      <path d="M7 8l5 8 5-8" stroke="#FFFFFF" strokeWidth="1.3" />
    </svg>
  );
}

export function InboundIntentLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#059669" />
      <path d="M5 12h14M13 6l6 6-6 6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="3" fill="#FFFFFF" />
    </svg>
  );
}

export function DirectorMatchLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#4F46E5" />
      <circle cx="12" cy="9" r="3.5" fill="#FFFFFF" />
      <path d="M6 19c0-3 3-5 6-5s6 2 6 5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 8l2 2 3-3" stroke="#A5B4FC" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CustomLlmLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#1E293B" />
      <circle cx="12" cy="12" r="6" stroke="#38BDF8" strokeWidth="1.5" />
      <path d="M12 8v8M8 12h8" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="#38BDF8" />
    </svg>
  );
}

export function RulesEngineLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#334155" />
      <rect x="5" y="5" width="6" height="6" rx="1" fill="#FFFFFF" />
      <rect x="13" y="5" width="6" height="6" rx="1" fill="#94A3B8" />
      <rect x="5" y="13" width="6" height="6" rx="1" fill="#94A3B8" />
      <rect x="13" y="13" width="6" height="6" rx="1" fill="#FFFFFF" />
    </svg>
  );
}

export function VectorRagLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#6366F1" />
      <circle cx="6" cy="12" r="2.5" fill="#FFFFFF" />
      <circle cx="18" cy="7" r="2.5" fill="#FFFFFF" />
      <circle cx="18" cy="17" r="2.5" fill="#FFFFFF" />
      <path d="M6 12l12-5M6 12l12 5" stroke="#E0E7FF" strokeWidth="1.4" />
    </svg>
  );
}

export function NewsSignalLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#EA580C" />
      <path d="M5 18h14M5 14h10M5 10h14M5 6h7" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="18" cy="7" r="2" fill="#FED7AA" />
    </svg>
  );
}
