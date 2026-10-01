"""Telnyx records assistant calls by default; ours must never, since we record on the call
itself and only when the company chose to."""


def test_assistant_shell_turns_telnyx_recording_off():
    from app.services.voice_assistants import shell_payload

    assert shell_payload("A", "B")["telephony_settings"]["recording_settings"] == {"enabled": False}
