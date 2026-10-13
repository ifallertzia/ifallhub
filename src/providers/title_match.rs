//! Conservative title identity checks shared by the web search and stream paths.
//!
//! Scraper search endpoints often return loosely related results. A title with
//! a shared sequel number is not enough to identify a movie, so matching here
//! requires the meaningful title words (and all numeric sequel markers) to
//! agree. Known language / release annotations are ignored.

/// Remove language/audio/release suffixes that commonly confuse scraper search
/// endpoints while retaining a bracketed release year as a plain search term.
pub fn sanitize_provider_query(raw: &str) -> String {
    let without_annotations = strip_annotations(raw, true);
    let without_suffix = strip_trailing_metadata(&without_annotations);
    without_suffix
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Return whether two titles plausibly identify the same work.
///
/// If both years are known they must agree. A candidate must contain every
/// meaningful query token in order, including sequel numbers. A small number
/// of extra subtitle words is allowed, but there is deliberately no "first
/// result" or numbers-only fallback.
pub fn titles_match(
    expected_title: &str,
    candidate_title: &str,
    expected_year: Option<&str>,
    candidate_year: Option<&str>,
) -> bool {
    let expected_year = normalize_year(expected_year).or_else(|| trailing_year(expected_title));
    let candidate_year = normalize_year(candidate_year).or_else(|| trailing_year(candidate_title));
    if expected_year
        .zip(candidate_year)
        .is_some_and(|(expected, candidate)| expected != candidate)
    {
        return false;
    }

    let expected = title_tokens(expected_title, false);
    let candidate = title_tokens(candidate_title, false);
    title_tokens_match(&expected, &candidate)
}

/// `Some(true/false)` when a release filename contains a title-like identity;
/// `None` means the filename is only technical/generic metadata, so the caller
/// should rely on the provider page's verified title instead.
pub fn release_title_matches(
    expected_title: &str,
    release_filename: &str,
    expected_year: Option<&str>,
) -> Option<bool> {
    let expected = title_tokens(expected_title, false);
    if !has_word_token(&expected) {
        return Some(false);
    }

    if let Some(expected_year) = normalize_year(expected_year) {
        if let Some(release_year) = release_year(release_filename, &expected) {
            if expected_year != release_year {
                return Some(false);
            }
        }
    }

    let candidate = title_tokens(release_filename, true);
    if !has_word_token(&candidate) || (candidate.len() == 1 && expected.len() > 1) {
        return None;
    }
    Some(title_tokens_match(&expected, &candidate))
}

fn strip_annotations(raw: &str, preserve_years: bool) -> String {
    let chars = raw.char_indices().collect::<Vec<_>>();
    let mut output = String::with_capacity(raw.len());
    let mut index = 0;

    while index < chars.len() {
        let (byte_index, character) = chars[index];
        let closing = match character {
            '[' => Some(']'),
            '(' => Some(')'),
            _ => None,
        };
        if let Some(closing) = closing
            && let Some(close_index) =
                (index + 1..chars.len()).find(|candidate| chars[*candidate].1 == closing)
        {
            let content_start = byte_index + character.len_utf8();
            let content_end = chars[close_index].0;
            let content = &raw[content_start..content_end];
            if annotation_is_metadata(content) {
                output.push(' ');
                if preserve_years {
                    for token in raw_tokens(content) {
                        if is_year_token(&token) {
                            output.push_str(&token);
                            output.push(' ');
                        }
                    }
                }
                index = close_index + 1;
                continue;
            }

            // Keep real parenthetical subtitles, but never send bracket syntax
            // itself to a scraper's query parser.
            output.push(' ');
            output.push_str(content);
            output.push(' ');
            index = close_index + 1;
            continue;
        }
        output.push(character);
        index += 1;
    }

    output
}

fn annotation_is_metadata(value: &str) -> bool {
    let tokens = raw_tokens(value);
    !tokens.is_empty()
        && tokens
            .iter()
            .all(|token| is_year_token(token) || is_metadata_token(token))
}

fn strip_trailing_metadata(value: &str) -> String {
    let spans = token_spans(value);
    if spans.is_empty() {
        return value.trim().to_string();
    }

    let mut first_suffix = spans.len();
    while first_suffix > 0 && is_metadata_token(&spans[first_suffix - 1].0) {
        first_suffix -= 1;
    }
    if first_suffix < spans.len() && first_suffix > 0 {
        return value[..spans[first_suffix].1]
            .trim_end_matches(|c: char| {
                c.is_whitespace() || matches!(c, '-' | '_' | '.' | ':' | '|')
            })
            .to_string();
    }
    value.trim().to_string()
}

fn title_tokens(value: &str, release_filename: bool) -> Vec<String> {
    let cleaned = strip_annotations(value, false);
    let cleaned = strip_trailing_metadata(&cleaned);
    let spans = token_spans(&cleaned);

    let mut tokens = Vec::with_capacity(spans.len());
    for (index, (token, _)) in spans.iter().enumerate() {
        if release_filename && is_release_metadata_token(token) {
            break;
        }
        if is_year_token(token) {
            // Keep numeric-title names such as "1917" or "2001: A Space
            // Odyssey", but ignore a trailing release year like "Dune 2021".
            if index > 0 {
                continue;
            }
        }
        if is_ignored_title_word(token) {
            continue;
        }
        tokens.push(normalize_number_word(token));
    }
    tokens
}

fn title_tokens_match(expected: &[String], candidate: &[String]) -> bool {
    if expected.is_empty() || candidate.is_empty() || !has_word_token(expected) {
        return false;
    }

    let expected_numbers = expected
        .iter()
        .filter(|token| is_number_token(token))
        .collect::<Vec<_>>();
    let candidate_numbers = candidate
        .iter()
        .filter(|token| is_number_token(token))
        .collect::<Vec<_>>();
    if expected_numbers != candidate_numbers {
        return false;
    }

    let mut candidate_index = 0;
    for expected_token in expected {
        let Some(relative_index) = candidate[candidate_index..]
            .iter()
            .position(|candidate_token| token_matches(expected_token, candidate_token))
        else {
            return false;
        };
        candidate_index += relative_index + 1;
    }

    let extra_tokens = candidate.len().saturating_sub(expected.len());
    // Permit a short subtitle/franchise suffix but not a long, different title
    // that happens to contain one shared word or number.
    extra_tokens <= (expected.len() / 2 + 2).max(3)
}

fn token_matches(expected: &str, candidate: &str) -> bool {
    if expected == candidate {
        return true;
    }
    if is_number_token(expected) || is_number_token(candidate) {
        return false;
    }
    let expected_chars = expected.chars().collect::<Vec<_>>();
    let candidate_chars = candidate.chars().collect::<Vec<_>>();
    let longest = expected_chars.len().max(candidate_chars.len());
    if longest < 5 {
        return false;
    }
    edit_distance(&expected_chars, &candidate_chars) <= longest / 5
}

fn edit_distance(left: &[char], right: &[char]) -> usize {
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_char) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right.iter().enumerate() {
            let substitution = previous[right_index] + if left_char == right_char { 0 } else { 1 };
            current[right_index + 1] = (previous[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn release_year(value: &str, expected_tokens: &[String]) -> Option<String> {
    token_spans(value)
        .into_iter()
        .map(|(token, _)| token)
        .find(|token| {
            is_year_token(token) && !expected_tokens.iter().any(|expected| expected == token)
        })
}

fn trailing_year(value: &str) -> Option<String> {
    let cleaned = strip_annotations(value, false);
    token_spans(&cleaned)
        .into_iter()
        .rev()
        .find_map(|(token, _)| is_year_token(&token).then_some(token))
}

fn normalize_year(value: Option<&str>) -> Option<String> {
    value.and_then(|value| {
        token_spans(value)
            .into_iter()
            .map(|(token, _)| token)
            .find(|token| is_year_token(token))
    })
}

fn raw_tokens(value: &str) -> Vec<String> {
    token_spans(value)
        .into_iter()
        .map(|(token, _)| token)
        .collect()
}

fn token_spans(value: &str) -> Vec<(String, usize)> {
    let mut tokens = Vec::new();
    let mut start = None;
    let mut token = String::new();

    for (byte_index, character) in value.char_indices() {
        if character.is_alphanumeric() {
            if start.is_none() {
                start = Some(byte_index);
            }
            token.extend(character.to_lowercase());
        } else if let Some(token_start) = start.take() {
            tokens.push((std::mem::take(&mut token), token_start));
        }
    }
    if let Some(token_start) = start {
        tokens.push((token, token_start));
    }
    tokens
}

fn has_word_token(tokens: &[String]) -> bool {
    tokens
        .iter()
        .any(|token| !is_number_token(token) || is_year_token(token))
}

fn is_number_token(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
}

fn is_year_token(value: &str) -> bool {
    value.len() == 4
        && value.chars().all(|character| character.is_ascii_digit())
        && value
            .parse::<u16>()
            .is_ok_and(|year| (1900..=2099).contains(&year))
}

fn is_ignored_title_word(value: &str) -> bool {
    matches!(
        value,
        "the" | "a" | "an" | "of" | "and" | "in" | "on" | "to" | "for"
    )
}

fn is_metadata_token(value: &str) -> bool {
    is_language_token(value)
        || is_release_metadata_token(value)
        || matches!(
            value,
            "dub"
                | "dubbed"
                | "audio"
                | "multi"
                | "dual"
                | "sub"
                | "subs"
                | "subtitle"
                | "subtitles"
                | "version"
        )
}

fn is_language_token(value: &str) -> bool {
    matches!(
        value,
        "hindi"
            | "hin"
            | "english"
            | "eng"
            | "tamil"
            | "tam"
            | "telugu"
            | "tel"
            | "kannada"
            | "kan"
            | "malayalam"
            | "mal"
            | "bengali"
            | "bangla"
            | "ben"
            | "marathi"
            | "mar"
            | "punjabi"
            | "pan"
            | "gujarati"
            | "guj"
            | "urdu"
            | "urd"
            | "spanish"
            | "spa"
            | "french"
            | "fra"
            | "fre"
            | "german"
            | "ger"
            | "deu"
            | "italian"
            | "ita"
            | "japanese"
            | "jpn"
            | "korean"
            | "kor"
            | "chinese"
            | "chi"
            | "mandarin"
            | "cantonese"
            | "russian"
            | "rus"
            | "portuguese"
            | "por"
            | "turkish"
            | "tur"
            | "arabic"
            | "ara"
            | "thai"
            | "indonesian"
            | "ind"
            | "vietnamese"
            | "vie"
            | "dutch"
            | "nld"
            | "polish"
            | "pol"
            | "swedish"
            | "swe"
            | "danish"
            | "dan"
            | "norwegian"
            | "nor"
            | "finnish"
            | "fin"
            | "greek"
            | "ell"
            | "hebrew"
            | "heb"
            | "czech"
            | "ces"
            | "hungarian"
            | "hun"
            | "romanian"
            | "ron"
            | "ukrainian"
            | "ukr"
            | "persian"
            | "fas"
            | "tagalog"
            | "filipino"
            | "malay"
            | "msa"
    )
}

fn is_release_metadata_token(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let resolution = lower.ends_with('p')
        && lower[..lower.len().saturating_sub(1)]
            .parse::<u16>()
            .is_ok_and(|number| (144..=8640).contains(&number));
    resolution
        || matches!(
            lower.as_str(),
            "4k" | "8k"
                | "uhd"
                | "hd"
                | "sd"
                | "hdr"
                | "hdr10"
                | "dv"
                | "web"
                | "dl"
                | "webdl"
                | "webrip"
                | "bluray"
                | "brrip"
                | "bdrip"
                | "hdrip"
                | "hdtv"
                | "remux"
                | "hevc"
                | "h264"
                | "h265"
                | "x264"
                | "x265"
                | "av1"
                | "aac"
                | "dts"
                | "mkv"
                | "mp4"
                | "avi"
                | "mov"
                | "wmv"
                | "flv"
                | "mp3"
                | "m4v"
                | "webm"
                | "proper"
                | "repack"
                | "limited"
                | "internal"
                | "unknown"
                | "release"
                | "file"
                | "video"
                | "stream"
                | "source"
                | "direct"
                | "download"
                | "link"
        )
        || (lower.starts_with('s')
            && lower.contains('e')
            && lower.chars().any(|character| character.is_ascii_digit()))
}

fn normalize_number_word(value: &str) -> String {
    match value {
        "one" => "1".into(),
        "two" => "2".into(),
        "three" => "3".into(),
        "four" => "4".into(),
        "five" => "5".into(),
        "six" => "6".into(),
        "seven" => "7".into(),
        "eight" => "8".into(),
        "nine" => "9".into(),
        "ten" => "10".into(),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{release_title_matches, sanitize_provider_query, titles_match};

    #[test]
    fn sanitizes_language_suffixes_and_keeps_years() {
        assert_eq!(sanitize_provider_query("Drishyam 2 [Hindi]"), "Drishyam 2");
        assert_eq!(
            sanitize_provider_query("Drishyam 2 (Hindi Dubbed)"),
            "Drishyam 2"
        );
        assert_eq!(
            sanitize_provider_query("Drishyam 2 [Hindi] [2022]"),
            "Drishyam 2 2022"
        );
        assert_eq!(
            sanitize_provider_query("Dune: Part Two (2024)"),
            "Dune: Part Two 2024"
        );
        assert_eq!(sanitize_provider_query("Hindi Medium"), "Hindi Medium");
    }

    #[test]
    fn compares_full_title_identity_instead_of_a_shared_number() {
        assert!(titles_match(
            "Drishyam 2 [Hindi]",
            "Drishyam 2 (2022)",
            Some("2022"),
            Some("2022"),
        ));
        assert!(!titles_match(
            "Drishyam 2 [Hindi]",
            "Cabin Fever 2 Spring Fever",
            Some("2022"),
            Some("2009"),
        ));
        assert!(!titles_match(
            "Drishyam 2",
            "Drishyam",
            Some("2022"),
            Some("2022"),
        ));
        assert!(!titles_match("2", "Cabin Fever 2", None, None));
    }

    #[test]
    fn tolerates_small_typos_and_title_annotations() {
        assert!(titles_match(
            "Interstelllar",
            "Interstellar (2014)",
            None,
            Some("2014")
        ));
        assert!(titles_match(
            "The Batman",
            "Batman",
            Some("2022"),
            Some("2022")
        ));
        assert!(titles_match(
            "Drishyam Two",
            "Drishyam 2",
            Some("2022"),
            Some("2022")
        ));
        assert!(!titles_match(
            "Halloween",
            "Halloween",
            Some("1978"),
            Some("2018")
        ));
    }

    #[test]
    fn release_names_are_checked_but_generic_names_use_verified_page_title() {
        assert_eq!(
            release_title_matches(
                "Drishyam 2 [Hindi]",
                "Cabin.Fever.2.Spring.Fever.2009.1080p.WEB-DL.mkv",
                Some("2022"),
            ),
            Some(false),
        );
        assert_eq!(
            release_title_matches(
                "Drishyam 2",
                "Drishyam.2.2022.1080p.WEB-DL.H.264.mkv",
                Some("2022"),
            ),
            Some(true),
        );
        assert_eq!(
            release_title_matches("Drishyam 2", "1080p WEB-DL H.264", Some("2022")),
            None,
        );
    }
}
