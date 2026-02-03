/**
 * Currency utilities based on GPS coordinates
 */

// Country to currency mapping
const countryToCurrency: { [key: string]: string } = {
    'IN': 'INR',
    'US': 'USD',
    'GB': 'GBP',
    'DE': 'EUR',
    'FR': 'EUR',
    'ES': 'EUR',
    'IT': 'EUR',
    'NL': 'EUR',
    'BE': 'EUR',
    'AT': 'EUR',
    'PT': 'EUR',
    'IE': 'EUR',
    'JP': 'JPY',
    'CA': 'CAD',
    'AU': 'AUD',
    'CN': 'CNY',
    'AE': 'AED',
    'SG': 'SGD',
    'HK': 'HKD',
    'CH': 'CHF',
    'SE': 'SEK',
    'NO': 'NOK',
    'DK': 'DKK',
    'NZ': 'NZD',
    'MX': 'MXN',
    'BR': 'BRL',
    'ZA': 'ZAR',
    'KR': 'KRW',
    'TH': 'THB',
    'MY': 'MYR',
    'PH': 'PHP',
    'ID': 'IDR',
    'VN': 'VND',
    'RU': 'RUB',
    'PL': 'PLN',
    'TR': 'TRY',
    'SA': 'SAR',
    'EG': 'EGP'
};

/**
 * Gets local currency based on GPS coordinates using reverse geocoding
 */
export async function getCurrencyFromLocation(lat: number, lon: number): Promise<string> {
    try {
        // Use Nominatim (OpenStreetMap) for reverse geocoding - free and no API key needed
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3`,
            { headers: { 'User-Agent': 'Parlens-PWA/1.0' } }
        );

        if (!response.ok) throw new Error('Geocoding failed');

        const data = await response.json();
        const countryCode = data.address?.country_code?.toUpperCase();

        if (countryCode && countryToCurrency[countryCode]) {
            return countryToCurrency[countryCode];
        }

        return 'USD'; // Default fallback
    } catch (e) {
        console.warn('Currency detection failed, using locale fallback:', e);
        return getLocalCurrency();
    }
}

/**
 * Fallback: Detects the local currency code based on the browser's locale.
 */
export function getLocalCurrency(): string {
    try {
        const locale = window.navigator.language;
        const country = locale.split('-')[1]?.toUpperCase();
        if (country && countryToCurrency[country]) {
            return countryToCurrency[country];
        }
        return 'USD';
    } catch (e) {
        return 'USD';
    }
}

/**
 * Gets the currency symbol for a currency code.
 */
export function getCurrencySymbol(currency: string): string {
    try {
        return (0).toLocaleString(window.navigator.language, {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).replace(/\d/g, '').trim();
    } catch (e) {
        const symbols: { [key: string]: string } = {
            'INR': '₹', 'USD': '$', 'GBP': '£', 'EUR': '€', 'JPY': '¥',
            'CAD': 'C$', 'AUD': 'A$', 'CNY': '¥', 'AED': 'د.إ', 'SGD': 'S$'
        };
        return symbols[currency] || '$';
    }
}

// Currency to Country Code mapping (primary country)
const currencyToCountry: { [key: string]: string } = {
    'INR': 'IN', 'USD': 'US', 'GBP': 'GB', 'EUR': 'EU', 'JPY': 'JP', 'CAD': 'CA', 'AUD': 'AU',
    'CNY': 'CN', 'AED': 'AE', 'SGD': 'SG', 'HKD': 'HK', 'CHF': 'CH', 'SEK': 'SE', 'NOK': 'NO',
    'DKK': 'DK', 'NZD': 'NZ', 'MXN': 'MX', 'BRL': 'BR', 'ZAR': 'ZA', 'KRW': 'KR', 'THB': 'TH',
    'MYR': 'MY', 'PHP': 'PH', 'IDR': 'ID', 'VND': 'VN', 'RUB': 'RU', 'PLN': 'PL', 'TRY': 'TR',
    'SAR': 'SA', 'EGP': 'EG'
};

/**
 * Gets the emoji flag for a currency code.
 */
export function getCountryFlag(currency: string): string {
    const countryCode = currencyToCountry[currency] || 'US';
    return countryCode
        .toUpperCase()
        .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
}
