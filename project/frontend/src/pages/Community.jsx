import { useEffect, useState } from "react";
import { fetchCommunityPosts, createCommunityPost, updateCommunityPost, likeCommunityPost, deleteCommunityPost, fetchMembers, fetchComments, createComment, deleteComment } from "../api";
import Notices from "./Notices";
import { resizeImageFiles } from "../utils/image";

function relTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  return d.toLocaleDateString("ko-KR");
}

function TabButton({ active, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        padding: "12px 4px",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
        color: active ? "var(--text)" : "var(--text-3)",
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: -1,
      }}
    >
      {label}
      {count != null && (
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 9999,
            background: active ? "var(--primary)" : "var(--border)",
            color: active ? "#fff" : "var(--text-3)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function FilterChip({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={active ? "btn sm" : "btn ghost sm"}
      style={{ borderRadius: 9999, padding: "4px 14px" }}
    >
      {children}
    </button>
  );
}

function PhotoPreview({ src, onRemove }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 12, border: "1px solid var(--border)" }}>
      <img src={src} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <button
        type="button"
        onClick={onRemove}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 26,
          height: 26,
          borderRadius: 9999,
          border: "1px solid rgba(255,255,255,0.8)",
          background: "rgba(0,0,0,0.45)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function FeedPostCard({ post, role, onLike, onDelete, onUpdate }) {
  const [liked, setLiked] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);

  const photos = Array.isArray(post.photos) ? post.photos : [];

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    onLike && onLike(post.post_id);
  };

  const toggleComments = async () => {
    if (!showComments) {
      const data = await fetchComments(post.post_id);
      setComments(data || []);
    }
    setShowComments(!showComments);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const added = await createComment(post.post_id, { content: newComment, author: role === "owner" ? "관리자" : "학부모" });
      setComments([...comments, added]);
      setNewComment("");
    } catch (err) {
      alert("댓글 작성 실패");
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    try {
      await deleteComment(commentId);
      setComments(comments.filter(c => c.comment_id !== commentId));
    } catch (err) {
      alert("삭제 실패");
    }
  };

  const handleUpdate = async () => {
    try {
      await onUpdate(post.post_id, { content: editContent, photos: post.photos });
      setIsEditing(false);
    } catch (err) {
      alert("수정 실패");
    }
  };

  return (
    <div className="card" style={{ position: "relative", padding: 20, marginBottom: 16 }}>
      {role === "owner" && !isEditing && (
        <div style={{ position: "absolute", top: 20, right: 20, display: "flex", gap: 6 }}>
          <button onClick={() => setIsEditing(true)} className="btn ghost sm">수정</button>
          <button onClick={() => onDelete && onDelete(post.post_id)} className="btn danger sm">삭제</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div className="avatar">관</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{post.author || "관리자"}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{relTime(post.created_at)}</div>
        </div>
      </div>

      {isEditing ? (
        <div style={{ marginBottom: 14 }}>
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            style={{ width: "100%", minHeight: 80, padding: 10, border: "1px solid var(--border)", borderRadius: 8, resize: "vertical", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => { setIsEditing(false); setEditContent(post.content); }} className="btn ghost sm">취소</button>
            <button onClick={handleUpdate} className="btn sm">저장</button>
          </div>
        </div>
      ) : (
        post.content && <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 14 }}>{post.content}</div>
      )}

      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: photos.length === 1 ? "1fr" : "1fr 1fr", gap: 8, borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 14 }}>
          {photos.slice(0, 4).map((src, i) => <img key={i} src={src} alt="community" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover" }} />)}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <button className={`btn ghost sm`} onClick={handleLike} style={{ flex: 1, color: liked ? "var(--primary)" : "var(--text-2)" }}>
          {liked ? "❤️" : "🤍"} 좋아요 {post.like_count}
        </button>
        <button className="btn ghost sm" onClick={toggleComments} style={{ flex: 1, color: showComments ? "var(--primary)" : "var(--text-2)" }}>
          💬 댓글
        </button>
      </div>

      {showComments && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--surface-2)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {comments.map(c => (
              <div key={c.comment_id} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "var(--surface-2)", padding: "10px 14px", borderRadius: 12, position: "relative" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{c.author}</span>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>{relTime(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{c.content}</div>
                </div>
                {role === "owner" && (
                  <button onClick={() => handleDeleteComment(c.comment_id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 11, padding: 0 }}>삭제</button>
                )}
              </div>
            ))}
            {comments.length === 0 && <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>댓글이 없습니다.</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="댓글을 입력하세요..."
              style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 20, fontSize: 13 }}
            />
            <button onClick={handleAddComment} className="btn sm" style={{ borderRadius: 20 }}>등록</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Composer({ role, content, photos, setContent, setPhotos, onSubmit, isSubmitting }) {
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";   // 같은 파일을 다시 고를 수 있도록
    try {
      // 1600px 로 줄여 올림 — 원본 그대로면 Vercel 요청 한도(4.5MB)를 넘어 게시가 실패
      const results = await resizeImageFiles(files, "post");
      setPhotos((prev) => [...prev, ...results].slice(0, 10));
      if (photos.length + results.length > 10) alert("사진은 게시물당 10장까지 올릴 수 있습니다.");
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div className="avatar">관</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: "var(--text)" }}>{role === "owner" ? "관리자" : "학부모"}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
            {role === "owner" ? "원장님은 공지/사진 게시물을 작성할 수 있습니다." : "학부모님은 관리자 게시물을 확인할 수 있습니다."}
          </div>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={role === "owner" ? "새 게시물을 작성하세요..." : "관리자 게시물을 확인하세요."}
        style={{
          width: "100%",
          minHeight: 120,
          resize: "vertical",
          padding: "12px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--background)",
          color: "var(--text)",
          marginBottom: 12
        }}
        disabled={role !== "owner"}
      />
      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))", gap: 10, marginBottom: 12 }}>
          {photos.map((src, index) => (
            <PhotoPreview key={index} src={src} onRemove={() => setPhotos((prev) => prev.filter((_, i) => i !== index))} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <label className="btn ghost sm" style={{ margin: 0, cursor: role === "owner" ? "pointer" : "not-allowed", opacity: role === "owner" ? 1 : 0.5 }}>
          📷 사진 추가
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} disabled={role !== "owner"} />
        </label>
        <button className="btn sm" onClick={onSubmit} disabled={role !== "owner" || isSubmitting} style={{ minWidth: 108 }}>
          {isSubmitting ? "등록 중..." : "게시하기"}
        </button>
      </div>
    </div>
  );
}

function NoticeRail({ posts }) {
  const notices = posts.filter((p) => p.content && p.content.length > 0).slice(0, 4);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>최근 게시물</span>
        <button className="btn ghost sm" style={{ padding: "2px 8px", fontSize: 11 }}>모두 보기</button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {notices.map((n) => (
          <div key={n.post_id} style={{ cursor: "pointer" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{n.author}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{relTime(n.created_at)}</div>
          </div>
        ))}
        {notices.length === 0 && <div className="empty" style={{ padding: 14, margin: 0 }}>게시물이 없습니다.</div>}
      </div>
    </div>
  );
}

function MembersRail({ members = [] }) {
  const displayMembers = members.slice(0, 10);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-head" style={{ marginBottom: 10 }}>
        <span className="card-title" style={{ fontSize: 13 }}>멤버</span>
        <span className="card-sub" style={{ fontSize: 11, marginTop: 0 }}>학생 {members.length}명</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {displayMembers.map((m) => (
          <div key={m.member_id} className="avatar sm" title={m.name}>
            {m.name?.[0] || "?"}
          </div>
        ))}
        {members.length > 10 && (
          <div className="avatar sm" style={{ background: "var(--border)", color: "var(--text-3)" }}>
            +{members.length - 10}
          </div>
        )}
      </div>
    </div>
  );
}

function ManagePostsModal({ posts, onClose, onDelete }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 800, maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>게시물 일괄 관리</h3>
          <button onClick={onClose} className="btn ghost sm">닫기</button>
        </div>
        <div style={{ overflowY: "auto", padding: 20, flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "10px 8px" }}>ID</th>
                <th style={{ padding: "10px 8px" }}>작성자</th>
                <th style={{ padding: "10px 8px" }}>내용 (요약)</th>
                <th style={{ padding: "10px 8px" }}>작성일</th>
                <th style={{ padding: "10px 8px" }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(p => (
                <tr key={p.post_id} style={{ borderBottom: "1px solid var(--surface-2)" }}>
                  <td style={{ padding: "10px 8px", fontSize: 13 }}>{p.post_id}</td>
                  <td style={{ padding: "10px 8px", fontSize: 13 }}>{p.author}</td>
                  <td style={{ padding: "10px 8px", fontSize: 13, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.content}</td>
                  <td style={{ padding: "10px 8px", fontSize: 13 }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "10px 8px" }}>
                    <button className="btn danger sm" onClick={() => onDelete(p.post_id)} style={{ padding: "4px 8px", fontSize: 12 }}>삭제</button>
                  </td>
                </tr>
              ))}
              {posts.length === 0 && <tr><td colSpan="5" style={{ textAlign: "center", padding: 20 }}>게시물이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 수정된 부분: undefined 에러 방지를 위해 매개변수(Parameters)의 기본값(Default values)을 할당했어.
function FeedTab({
  role,
  posts = [],
  members = [],
  loading = false,
  error = null,
  showComposer = false,
  setShowComposer = () => { },
  showManagePosts = false,
  setShowManagePosts = () => { },
  draftContent = "",
  draftPhotos = [],
  setDraftContent = () => { },
  setDraftPhotos = () => { },
  createPost = () => { },
  isPosting = false,
  onLike = () => { },
  onDelete = () => { },
  onUpdate = () => { }
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
      {showManagePosts && (
        <ManagePostsModal
          posts={posts}
          onClose={() => setShowManagePosts(false)}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 6 }}>커뮤니티 피드</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>최신 공지와 사진을 한곳에서 확인하세요.</div>
            </div>
            {role === "owner" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" onClick={() => setShowManagePosts(true)}>게시물 관리</button>
                <button className="btn" onClick={() => setShowComposer((visible) => !visible)}>
                  {showComposer ? "작성 닫기" : "게시글 작성"}
                </button>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, color: "var(--text-2)", fontSize: 13, lineHeight: 1.7 }}>
            게시글 목록이 먼저 표시됩니다. 원장님은 게시글 작성 버튼을 눌러 알림과 사진을 등록하실 수 있으며, 학부모님은 최신 공지를 읽고 사진첩을 확인할 수 있습니다.
          </div>
        </div>

        {showComposer && role === "owner" && (
          <Composer
            role={role}
            content={draftContent}
            photos={draftPhotos}
            setContent={setDraftContent}
            setPhotos={setDraftPhotos}
            onSubmit={createPost}
            isSubmitting={isPosting}
          />
        )}

        {loading ? (
          <div className="empty">불러오는 중…</div>
        ) : error ? (
          <div className="error-banner">{error}</div>
        ) : posts.length === 0 ? (
          <div className="empty">아직 게시물이 없습니다.</div>
        ) : (
          posts.map((post) => (
            <FeedPostCard
              key={post.post_id}
              post={post}
              role={role}
              onLike={onLike}
              onDelete={onDelete}
              onUpdate={onUpdate}
            />
          ))
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NoticeRail posts={posts || []} />
        <MembersRail members={members || []} />
      </div>
    </div>
  );
}


function NoticeTab({ role }) {
  return (
    <div style={{ marginTop: 20 }}>
      <Notices role={role} />
    </div>
  );
}

function PhotosTab({ role, posts }) {
  const photoPosts = posts.filter(p => Array.isArray(p.photos) && p.photos.length > 0);
  return (
    <div>
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>사진첩 ({photoPosts.length})</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {photoPosts.map((p) => (
          <div key={p.post_id} className="card" style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}>
            <div style={{ aspectRatio: "4/3", background: "var(--surface-2)", position: "relative" }}>
              <img src={p.photos[0]} alt="cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.25), transparent)" }} />
              <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4 }}>
                {p.photos.length}장
              </div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.content ? (p.content.length > 20 ? p.content.slice(0, 20) + "..." : p.content) : "사진 게시물"}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>{relTime(p.created_at)} · {p.author || "관리자"}</div>
            </div>
          </div>
        ))}
        {photoPosts.length === 0 && <div className="empty" style={{ gridColumn: "1 / -1" }}>등록된 사진이 없습니다.</div>}
      </div>
    </div>
  );
}

function MembersTab({ members }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>학생</th>
              <th>학부모</th>
              <th>연락처</th>
              <th>상태</th>
              <th>등록일</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.member_id}>
                <td>
                  <div className="member-cell">
                    <div className="avatar sm">{m.name?.[0] || "?"}</div>
                    <span className="name">{m.name}</span>
                  </div>
                </td>
                <td style={{ color: "var(--text-2)" }}>{m.father_name || m.mother_name || "-"}</td>
                <td style={{ color: "var(--text-2)" }}>{m.father_phone || m.mother_phone || "-"}</td>
                <td>
                  <span className={`badge ${m.status === "ACTIVE" ? "success" : "gray"}`}>
                    {m.status === "ACTIVE" ? "재원" : "퇴원"}
                  </span>
                </td>
                <td style={{ color: "var(--text-2)" }}>{m.enrollment_date?.slice(0, 10)}</td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan="5" className="empty" style={{ border: "none" }}>등록된 멤버가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Community() {
  const [tab, setTab] = useState("feed");
  const [role, setRole] = useState("owner");

  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showManagePosts, setShowManagePosts] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    loadPosts();
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      const data = await fetchMembers();
      setMembers(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadPosts = async () => {
    setLoading(true);
    try {
      const data = await fetchCommunityPosts();
      setPosts(data || []);
    } catch (err) {
      setError("게시물을 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePost = async () => {
    if (!draftContent.trim() && draftPhotos.length === 0) return;
    setIsPosting(true);
    try {
      await createCommunityPost({ content: draftContent, photos: draftPhotos });
      setDraftContent("");
      setDraftPhotos([]);
      setShowComposer(false);
      loadPosts();
    } catch (err) {
      alert("게시물 등록 실패");
    } finally {
      setIsPosting(false);
    }
  };

  const handleLike = async (id) => {
    try {
      await likeCommunityPost(id);
      setPosts((prev) => prev.map((p) => p.post_id === id ? { ...p, like_count: (p.like_count || 0) + 1 } : p));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    try {
      await deleteCommunityPost(id);
      loadPosts();
    } catch (err) {
      alert("삭제 실패");
    }
  };

  const handleUpdatePost = async (id, data) => {
    try {
      await updateCommunityPost(id, data);
      loadPosts();
    } catch (err) {
      alert("수정 실패");
    }
  };

  const ownerTabs = [["feed", "피드", null], ["notice", "공지", null], ["photos", "사진첩", null], ["members", "멤버관리", null]];
  const parentTabs = [["feed", "피드", null], ["notice", "공지", null], ["photos", "사진첩", null]];
  const tabs = role === "owner" ? ownerTabs : parentTabs;

  const safeTab = role === "parent" && tab === "members" ? "feed" : tab;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 0 }}>
        <div>
          <h2 className="page-title" style={{ marginBottom: 2 }}>커뮤니티</h2>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>관리자와 학부모가 함께 소통하는 공식 커뮤니티입니다.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>보기:</span>
          <div style={{ display: "flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 3, gap: 2 }}>
            {[["owner", "관장님"], ["parent", "학부모님"]].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setRole(v)}
                style={{
                  padding: "4px 12px", borderRadius: 6, border: "none",
                  background: role === v ? "var(--surface)" : "transparent",
                  color: role === v ? "var(--text)" : "var(--text-3)",
                  fontWeight: role === v ? 700 : 500,
                  fontSize: 12, cursor: "pointer",
                  boxShadow: role === v ? "var(--shadow-sm)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--border)", marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(([id, label]) => (
          <TabButton key={id} active={safeTab === id} label={label} onClick={() => setTab(id)} />
        ))}
      </div>

      {safeTab === "feed" && <FeedTab
        role={role}
        posts={posts}
        members={members}
        loading={loading}
        error={error}
        showComposer={showComposer}
        setShowComposer={setShowComposer}
        showManagePosts={showManagePosts}
        setShowManagePosts={setShowManagePosts}
        draftContent={draftContent}
        draftPhotos={draftPhotos}
        setDraftContent={setDraftContent}
        setDraftPhotos={setDraftPhotos}
        createPost={handleCreatePost}
        isPosting={isPosting}
        onLike={handleLike}
        onDelete={handleDelete}
        onUpdate={handleUpdatePost}
      />}

      {safeTab === "notice" && <NoticeTab role={role} />}
      {safeTab === "photos" && <PhotosTab role={role} posts={posts} />}
      {safeTab === "members" && role === "owner" && <MembersTab members={members} />}
    </>
  );
}