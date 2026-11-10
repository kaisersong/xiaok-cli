/* Shared original SQL history helpers; no Main/session mutation entry. */
static const char *nr_execution_classes[]={"room_discussion","room_project","kswarm_direct","workflow_root","dsh_draft","nested_subagent","admission_probe","live_preview","snapshot_prep","tool_worker","main_turn","goal_turn","material_turn","canvas_turn"};
static int nr_physical_policy(nr_session *s,int kind,nr_cell *cells){
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT * FROM root_physical_policy WHERE kind=?",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_int(stmt,1,kind)==SQLITE_OK&&sqlite3_step(stmt)==SQLITE_ROW;
 for(int i=0;i<8&&good;i++)good=nr_from_column(cells+i,stmt,i);
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 good=good&&cells[0].type==SQLITE_INTEGER&&cells[0].integer==kind&&cells[3].type==SQLITE_INTEGER&&cells[3].integer==(kind==1?4:2)&&cells[4].type==SQLITE_INTEGER&&cells[4].integer==256;
 for(int i=5;i<8&&good;i++)good=cells[i].type==SQLITE_INTEGER&&cells[i].integer>=0&&cells[i].integer<NR_MAX_SAFE;
 return good;
}
static int nr_physical_row(nr_session *s,int kind,const char *key,nr_cell *cells){
 sqlite3_stmt *stmt=NULL;int result=-1;
 if(sqlite3_prepare_v2(s->db,"SELECT * FROM root_physical_resources WHERE resource_kind=? AND execution_key=?",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_int(stmt,1,kind)==SQLITE_OK&&sqlite3_bind_text(stmt,2,key,-1,SQLITE_TRANSIENT)==SQLITE_OK){
  int step=sqlite3_step(stmt);if(step==SQLITE_DONE)result=0;
  else if(step==SQLITE_ROW){int good=1;for(int i=0;i<14&&good;i++)good=nr_from_column(cells+i,stmt,i);if(good&&sqlite3_step(stmt)==SQLITE_DONE)result=1;}
 }
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)result=-1;
 if(result==1){char digest[65];if(cells[4].type!=SQLITE_TEXT||cells[5].type!=SQLITE_TEXT||!nr_hash((const char*)cells[4].bytes,digest)||cells[5].length!=64||memcmp(digest,cells[5].bytes,64))result=-1;}
 return result;
}
static int nr_role(const nr_cell *row,const char *role){return row[11].type==SQLITE_TEXT&&!strcmp((const char*)row[11].bytes,role);}
static int nr_state(const nr_cell *row,const char *state){return row[7].type==SQLITE_TEXT&&!strcmp((const char*)row[7].bytes,state);}
static int nr_receipt(nr_cell *receipt,const nr_cell *row,const char *kind,const char *token){
 char json[1024],hash[65];
 snprintf(json,sizeof(json),"{\"claimToken\":\"%s\",\"recordId\":\"%s\",\"state\":\"%s\"}",token?token:"",(const char*)row[0].bytes,kind);
 return nr_hash(json,hash)&&nr_text(receipt,(const char*)row[0].bytes)&&nr_text(receipt+1,kind)&&nr_text(receipt+2,hash)&&nr_text(receipt+3,json);
}
