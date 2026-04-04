//! Forensic flag analysis — risk flag detection from evidence data.

use super::ForensicFlag;

pub fn analyze_flags(evidence: &serde_json::Value) -> Vec<ForensicFlag> {
    let mut flags = Vec::new();

    let geo = evidence.get("geo");
    let fp = evidence.get("fingerprint");
    let behavioral = evidence.get("behavioral");

    // Network / identity hiding
    if geo.and_then(|g| g.get("isVpn")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "VPN_DETECTED".into(),
            severity: "warn".into(),
            message: "Signer is using a VPN service".into(),
        });
    }
    if geo.and_then(|g| g.get("isProxy")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "PROXY_DETECTED".into(),
            severity: "warn".into(),
            message: "Signer is connecting through a proxy".into(),
        });
    }
    if geo.and_then(|g| g.get("isTor")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "TOR_DETECTED".into(),
            severity: "critical".into(),
            message: "Signer is using the Tor network".into(),
        });
    }
    if geo.and_then(|g| g.get("isDatacenter")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "DATACENTER_IP".into(),
            severity: "warn".into(),
            message: "IP belongs to a datacenter/cloud provider".into(),
        });
    }
    if geo.and_then(|g| g.get("isBot")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "BOT_DETECTED".into(),
            severity: "critical".into(),
            message: "IP flagged as a known bot or attacker".into(),
        });
    }
    if let Some(score) = geo
        .and_then(|g| g.get("fraudScore"))
        .and_then(|v| v.as_f64())
    {
        if score >= 75.0 {
            flags.push(ForensicFlag {
                code: "HIGH_FRAUD_SCORE".into(),
                severity: "critical".into(),
                message: format!("IP fraud score is {score}/100"),
            });
        }
    }

    // Automation
    if fp.and_then(|f| f.get("webdriver")).and_then(|v| v.as_bool()) == Some(true) {
        flags.push(ForensicFlag {
            code: "WEBDRIVER_DETECTED".into(),
            severity: "critical".into(),
            message: "Browser controlled by automation (webdriver)".into(),
        });
    }

    // Behavioral anomalies
    if let Some(time_on_page) = behavioral
        .and_then(|b| b.get("timeOnPage"))
        .and_then(|v| v.as_f64())
    {
        if time_on_page < 3000.0 {
            flags.push(ForensicFlag {
                code: "RAPID_SIGNING".into(),
                severity: "warn".into(),
                message: format!(
                    "Signed in {}s (suspiciously fast)",
                    (time_on_page / 1000.0).round()
                ),
            });
        }
    }

    if behavioral
        .and_then(|b| b.get("mouseMoveCount"))
        .and_then(|v| v.as_i64())
        == Some(0)
    {
        if fp
            .and_then(|f| f.get("touchPoints"))
            .and_then(|v| v.as_i64())
            == Some(0)
        {
            flags.push(ForensicFlag {
                code: "NO_MOUSE_MOVEMENT".into(),
                severity: "info".into(),
                message: "No mouse/touch interaction during signing".into(),
            });
        }
    }

    if behavioral
        .and_then(|b| b.get("scrolledToBottom"))
        .and_then(|v| v.as_bool())
        == Some(false)
    {
        let scroll = behavioral
            .and_then(|b| b.get("maxScrollDepth"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        flags.push(ForensicFlag {
            code: "DID_NOT_SCROLL_FULL".into(),
            severity: "info".into(),
            message: format!("Only scrolled to {scroll}% of document"),
        });
    }

    // Tracking resistance
    if fp.and_then(|f| f.get("cookieEnabled")).and_then(|v| v.as_bool()) == Some(false) {
        flags.push(ForensicFlag {
            code: "COOKIES_DISABLED".into(),
            severity: "warn".into(),
            message: "Cookies disabled (limits identity tracking)".into(),
        });
    }

    flags
}
