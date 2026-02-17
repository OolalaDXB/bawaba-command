use once_cell::sync::Lazy;
use regex::Regex;

pub struct PIIPattern {
    pub name: &'static str,
    pub regex: &'static Lazy<Regex>,
}

// IBAN: 2 alpha + 2 digits + up to 30 alnum
static IBAN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b").unwrap()
});

// International phone: +XX followed by digits, spaces, dashes
static PHONE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\+\d{1,3}[\s\-]?\d{1,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}").unwrap()
});

// Email
static EMAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b").unwrap()
});

// Morocco CIN: 1-2 letters + 5-7 digits
static MOROCCO_CIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z]{1,2}\d{5,7}\b").unwrap()
});

// KSA National ID / Iqama: starts with 1 or 2, 10 digits total
static KSA_NID_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[12]\d{9}\b").unwrap()
});

// UAE Emirates ID: 784-YYYY-NNNNNNN-C (15 digits)
static UAE_EID_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b784[\-]?\d{4}[\-]?\d{7}[\-]?\d\b").unwrap()
});

// Credit card: 13-19 digits (spaces/dashes allowed between groups of 4)
static CARD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}\b").unwrap()
});

pub static PATTERNS: &[PIIPattern] = &[
    PIIPattern { name: "iban", regex: &IBAN_RE },
    PIIPattern { name: "email", regex: &EMAIL_RE },
    PIIPattern { name: "phone", regex: &PHONE_RE },
    PIIPattern { name: "emirates_id", regex: &UAE_EID_RE },
    PIIPattern { name: "card", regex: &CARD_RE },
    PIIPattern { name: "ksa_nid", regex: &KSA_NID_RE },
    PIIPattern { name: "morocco_cin", regex: &MOROCCO_CIN_RE },
];

/// Luhn validation for credit card numbers.
pub fn luhn_check(number: &str) -> bool {
    let digits: Vec<u32> = number
        .chars()
        .filter(|c| c.is_ascii_digit())
        .map(|c| c.to_digit(10).unwrap())
        .collect();

    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    let mut sum = 0u32;
    let mut double = false;

    for &d in digits.iter().rev() {
        let mut val = d;
        if double {
            val *= 2;
            if val > 9 {
                val -= 9;
            }
        }
        sum += val;
        double = !double;
    }

    sum % 10 == 0
}
