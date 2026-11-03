"""v12 — 입고 시 재고 자동 등록 · 커뮤니티 대댓글/익명/댓글 공감/HOT"""
from conftest import create_facility, login, parent_in


def _shop_owner(email: str, name: str):
    owner = login(email, "admin", "owner-invite-code")
    owner.facility_id = create_facility(owner, name, facility_type="학원")
    return owner


def _product(owner, name):
    items = owner.get("/api/shop/search", params={"q": name, "personalize": False}).json()["items"]
    return next(i for i in items if i["name"] == name)


def _paid_order(owner, items):
    order = owner.post("/api/shop/orders", json={"items": items}).json()
    owner.post(f"/api/shop/orders/{order['order_id']}/pay", json={"method": "CARD", "expected_total": order["total"]})
    return order["order_id"]


# ---------------------------------------------------------------------------------------------------------
# 입고 → 재고 현황
# ---------------------------------------------------------------------------------------------------------
def test_receive_registers_unlinked_product_in_inventory():
    """재고 물품과 연결되지 않은 상품도 입고하면 재고 현황에 새 물품으로 등록·연결되고, 다음 입고 때는 같은 물품에 더해짐"""
    owner = _shop_owner("recv-owner@example.com", "입고 테스트 학원")
    paper = _product(owner, "A4 복사지 80g (2,500매)")
    assert owner.get("/api/inventory").json()["items"] == []
    oid = _paid_order(owner, [{"product_id": paper["product_id"], "quantity": 2}])
    received = owner.post(f"/api/shop/orders/{oid}/receive").json()
    applied = received["inventory_applied"]
    assert len(applied) == 1 and applied[0]["created"] is True and applied[0]["quantity"] == 2
    items = owner.get("/api/inventory").json()["items"]
    assert [i["name"] for i in items] == [paper["name"]]
    assert items[0]["quantity"] == 2 and items[0]["shop_product_id"] == paper["product_id"]
    # 두 번째 주문은 새로 만들지 않고 같은 물품에 더함
    oid2 = _paid_order(owner, [{"product_id": paper["product_id"], "quantity": 3}])
    again = owner.post(f"/api/shop/orders/{oid2}/receive").json()["inventory_applied"][0]
    assert again["created"] is False and again["quantity"] == 5
    assert len(owner.get("/api/inventory").json()["items"]) == 1


def test_receive_matches_existing_item_by_name():
    owner = _shop_owner("recv-name@example.com", "이름 매칭 학원")
    paper = _product(owner, "A4 복사지 80g (2,500매)")
    inv = owner.post("/api/inventory", json={"name": paper["name"], "unit": "박스", "quantity": 1}).json()
    oid = _paid_order(owner, [{"product_id": paper["product_id"], "quantity": 1}])
    applied = owner.post(f"/api/shop/orders/{oid}/receive").json()["inventory_applied"][0]
    assert applied["item_id"] == inv["item_id"] and applied["quantity"] == 2 and applied["created"] is False


# ---------------------------------------------------------------------------------------------------------
# 커뮤니티
# ---------------------------------------------------------------------------------------------------------
def test_replies_anonymous_numbering_likes_and_soft_delete():
    owner = login("cm-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "댓글 테스트 도장")
    writer = parent_in("cm-writer@example.com", fid)
    a = parent_in("cm-a@example.com", fid)
    b = parent_in("cm-b@example.com", fid)

    post = writer.post("/api/parent/community/posts", json={"title": "익명 질문", "content": "도복 사이즈 어떻게 고르나요?",
                                                            "is_anonymous": True}).json()
    pid = post["post_id"]
    assert post["author"] == "익명" and post["is_anonymous"] is True
    assert "익명 (" in owner.get(f"/api/community/posts/{pid}").json()["author"]        # 관리자는 실제 작성자 확인
    # 익명 글은 작성자 이름으로 검색되지 않음
    nick = owner.get(f"/api/community/posts/{pid}").json()["author"].split("(", 1)[1].rstrip(")")
    found = a.get("/api/parent/community/board", params={"q": nick, "field": "author"}).json()["items"]
    assert all(i.get("post_id") != pid for i in found)

    c1 = a.post(f"/api/parent/community/posts/{pid}/comments", json={"content": "한 치수 크게요", "is_anonymous": True}).json()
    c2 = b.post(f"/api/parent/community/posts/{pid}/comments", json={"content": "저도 궁금해요", "is_anonymous": True}).json()
    w = writer.post(f"/api/parent/community/posts/{pid}/comments",
                    json={"content": "감사합니다", "is_anonymous": True, "parent_comment_id": c1["comment_id"]}).json()
    again = a.post(f"/api/parent/community/posts/{pid}/comments", json={"content": "실명 댓글", "is_anonymous": False}).json()
    assert (c1["author"], c2["author"], w["author"]) == ("익명1", "익명2", "익명(글쓴이)")
    assert w["is_writer"] and w["parent_comment_id"] == c1["comment_id"]
    assert again["author"] != "익명1" and not again["is_anonymous"]
    # 답글에 단 답글은 원 댓글에 붙음
    r2 = b.post(f"/api/parent/community/posts/{pid}/comments",
                json={"content": "답글의 답글", "parent_comment_id": w["comment_id"]}).json()
    assert r2["parent_comment_id"] == c1["comment_id"]
    # 다른 글의 댓글에는 답글 불가
    other = writer.post("/api/parent/community/posts", json={"title": "다른 글", "content": "본문"}).json()
    assert b.post(f"/api/parent/community/posts/{other['post_id']}/comments",
                  json={"content": "x", "parent_comment_id": c1["comment_id"]}).status_code == 404
    # 답글 알림
    assert any("답글" in n["title"] for n in a.get("/api/parent/notifications").json()["items"])

    # 공감 토글
    liked = b.post(f"/api/parent/community/comments/{c1['comment_id']}/like").json()
    assert liked == {"comment_id": c1["comment_id"], "like_count": 1, "liked": True}
    assert b.post(f"/api/parent/community/comments/{c1['comment_id']}/like").json()["liked"] is False
    b.post(f"/api/parent/community/comments/{c1['comment_id']}/like")
    rows = {c["comment_id"]: c for c in b.get(f"/api/parent/community/posts/{pid}/comments").json()}
    assert rows[c1["comment_id"]]["liked"] and rows[c1["comment_id"]]["like_count"] == 1

    # 답글이 있는 댓글을 지우면 '삭제된 댓글' 자리만 남고, 답글이 모두 지워지면 사라짐
    assert a.delete(f"/api/parent/community/comments/{c1['comment_id']}").status_code == 204
    rows = {c["comment_id"]: c for c in b.get(f"/api/parent/community/posts/{pid}/comments").json()}
    assert rows[c1["comment_id"]]["deleted"] and rows[c1["comment_id"]]["content"] == ""
    assert b.post(f"/api/parent/community/posts/{pid}/comments",
                  json={"content": "x", "parent_comment_id": c1["comment_id"]}).status_code == 409
    board = b.get("/api/parent/community/board").json()["items"]
    assert next(i for i in board if i.get("post_id") == pid)["comment_count"] == 4        # 삭제된 댓글은 세지 않음
    writer.delete(f"/api/parent/community/comments/{w['comment_id']}")
    b.delete(f"/api/parent/community/comments/{r2['comment_id']}")
    ids = {c["comment_id"] for c in b.get(f"/api/parent/community/posts/{pid}/comments").json()}
    assert c1["comment_id"] not in ids

    # 관리자 답글 · 관리자 공감 · 관리자 화면의 실명 표시
    admin_reply = owner.post(f"/api/community/posts/{pid}/comments",
                             json={"content": "운영자 답변", "parent_comment_id": c2["comment_id"]}).json()
    assert admin_reply["parent_comment_id"] == c2["comment_id"] and admin_reply["author_role"] == "admin"
    assert owner.post(f"/api/community/comments/{c2['comment_id']}/like").json()["like_count"] == 1
    admin_rows = {c["comment_id"]: c for c in owner.get(f"/api/community/posts/{pid}/comments").json()}
    assert admin_rows[c2["comment_id"]]["author"].startswith("익명2 (")
    # 글 삭제 시 댓글 공감도 함께 정리
    assert writer.delete(f"/api/parent/community/posts/{pid}").status_code == 204


def test_hot_board_by_likes():
    owner = login("hot-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "HOT 테스트 도장")
    post = owner.post("/api/community/posts", json={"title": "인기 글", "content": "본문"}).json()
    cold = owner.post("/api/community/posts", json={"title": "조용한 글", "content": "본문"}).json()
    for i in range(3):
        p = parent_in(f"hot-p{i}@example.com", fid)
        p.post(f"/api/parent/community/posts/{post['post_id']}/like")
    hot = owner.get("/api/community/board", params={"category": "HOT"}).json()
    ids = [i["post_id"] for i in hot["items"]]
    assert post["post_id"] in ids and cold["post_id"] not in ids
    assert hot["items"][0]["is_hot"] and hot["hot_likes"] >= 1
