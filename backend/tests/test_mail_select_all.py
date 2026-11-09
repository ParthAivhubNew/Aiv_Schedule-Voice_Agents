from types import SimpleNamespace as M

from app.api.mail_client import SELECT_ALL_CAP, ActionBody, same_folder_thread, thread_heads


def msg(id, thread="", box="b1", folder="inbox"):
    return M(id=id, thread_key=thread, mailbox_id=box, folder=folder)


def test_each_conversation_shows_once_by_its_newest_message():
    rows = [msg("m3", "t1"), msg("m2", "t2"), msg("m1", "t1"), msg("solo")]
    assert [m.id for m in thread_heads(rows)] == ["m3", "m2", "solo"]


def test_a_bulk_action_takes_the_whole_conversation_in_that_folder_only():
    picked = [msg("m3", "t1")]
    near = [msg("m3", "t1"), msg("m1", "t1"), msg("m0", "t1", folder="sent"), msg("x", "t1", box="b2"), msg("y", "t9")]
    assert sorted(m.id for m in same_folder_thread(picked, near)) == ["m1", "m3"]


def test_a_message_with_no_conversation_stays_alone():
    assert [m.id for m in same_folder_thread([msg("solo")], [msg("other")])] == ["solo"]


def test_actions_stay_on_single_messages_unless_asked():
    assert ActionBody(ids=["a"], action="read").threads is False
    assert SELECT_ALL_CAP == 500
