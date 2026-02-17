export const getRegistryUrl = () => {
    // Allow override for local testing / staging
    if (process.env.EKAIROS_REGISTRY_URL) {
        return process.env.EKAIROS_REGISTRY_URL;
    }
    // Default production URL (canonical base)
    return "https://registry.ekairos.dev/";
};

export const REGISTRY_ALIAS = "@ekairos";


