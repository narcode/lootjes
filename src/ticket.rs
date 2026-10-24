//! A ticket is one person's result: their own name plus the names they drew.
//! It is packed into a short URL-safe string so it can live in a link.
//!
//! Packing:   [len][name bytes] [len][pick bytes] [len][pick bytes] ...
//!            -> XOR with KEY (hides names from a casual glance, NOT encryption)
//!            -> base64url (only characters that are safe in a URL)

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

const KEY: &[u8] = b"sinterklaas";

#[derive(Debug, PartialEq)]
pub struct Ticket {
    pub name: String,
    pub picks: Vec<String>,
}

pub fn encode(ticket: &Ticket) -> Option<String> {
    let mut bytes = Vec::new();
    for s in std::iter::once(&ticket.name).chain(&ticket.picks) {
        // One byte holds the length, so a name can be at most 255 bytes.
        let len = u8::try_from(s.len()).ok()?;
        bytes.push(len);
        bytes.extend_from_slice(s.as_bytes());
    }
    xor(&mut bytes);
    Some(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn decode(code: &str) -> Option<Ticket> {
    let mut bytes = URL_SAFE_NO_PAD.decode(code).ok()?;
    xor(&mut bytes);

    let mut names = Vec::new();
    let mut rest = bytes.as_slice();
    while let Some((&len, tail)) = rest.split_first() {
        let len = len as usize;
        if tail.len() < len {
            return None; // link was cut off or mangled
        }
        let (name, tail) = tail.split_at(len);
        names.push(String::from_utf8(name.to_vec()).ok()?);
        rest = tail;
    }

    let mut names = names.into_iter();
    let name = names.next()?;
    let picks: Vec<String> = names.collect();
    if picks.is_empty() {
        return None;
    }
    Some(Ticket { name, picks })
}

/// XOR every byte with the repeating key. Doing it twice gives back the original.
fn xor(bytes: &mut [u8]) {
    for (b, k) in bytes.iter_mut().zip(KEY.iter().cycle()) {
        *b ^= k;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(name: &str, picks: &[&str]) -> Ticket {
        Ticket {
            name: name.into(),
            picks: picks.iter().map(|&p| p.into()).collect(),
        }
    }

    #[test]
    fn round_trip() {
        let t = ticket("Anna", &["Bram", "Daan", "Eva"]);
        let code = encode(&t).unwrap();
        assert_eq!(decode(&code), Some(t));
    }

    #[test]
    fn unicode_names() {
        let t = ticket("Zoë", &["Jürgen", "Ľuboš", "🎅"]);
        assert_eq!(decode(&encode(&t).unwrap()), Some(t));
    }

    #[test]
    fn names_not_readable_in_code() {
        let code = encode(&ticket("Anna", &["Bram", "Daan", "Eva"])).unwrap();
        assert!(!code.contains("Anna") && !code.contains("Bram"));
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn broken_codes_are_rejected() {
        let code = encode(&ticket("Anna", &["Bram", "Daan", "Eva"])).unwrap();
        assert_eq!(decode(&code[..code.len() - 4]), None); // truncated
        assert_eq!(decode("not a code!"), None);
        assert_eq!(decode(""), None);
    }

    #[test]
    fn too_long_name() {
        let long = "x".repeat(256);
        assert_eq!(encode(&ticket(&long, &["Bram"])), None);
    }
}
