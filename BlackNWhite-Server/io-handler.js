const url = require('url');
const async = require('async');
//const func = require('./server_functions/db_func');
const { Socket } = require('dgram');
const { stringify } = require('querystring');
const config = require('./configure');

const REDIS_PORT = 6380;
const Redis = require("ioredis"); 
const redisClient = new Redis(REDIS_PORT);
const { RedisSessionStore } = require("./sessionStore");
const sessionStore = new RedisSessionStore(redisClient);

const { redisHashTableStore } = require("./redisHashTableStore");
const hashtableStore = new redisHashTableStore(redisClient);

const { RedisJsonStore } = require("./redisJsonStore");
const jsonStore = new RedisJsonStore(redisClient);
const { RedisRoomStore, InMemoryRoomStore } = require("./roomStore");
const redis_room = new RedisRoomStore(redisClient);

const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const RoomTotalSchema = require("./schemas/roomTotal/RoomTotalSchema");
const BlackTeam = require("./schemas/roomTotal/BlackTeam");
const WhiteTeam = require("./schemas/roomTotal/WhiteTeam");
const BlackUsers = require("./schemas/roomTotal/BlackUsers");
const UserCompanyStatus = require("./schemas/roomTotal/UserCompanyStatus");
const WhiteUsers = require("./schemas/roomTotal/WhiteUsers");
const Company = require("./schemas/roomTotal/Company");
const Section = require("./schemas/roomTotal/Section");
const Progress = require("./schemas/roomTotal/Progress");

module.exports = (io) => {
    
    var gameserver = io.of("blacknwhite");
 
    var rooms ={};  // 여러 방 정보를 저장하는 딕셔너리
    var userPlacement ={}; // # WaitingRoom TeamChange 및 UI 배치 관련 정보 저장
    let Players = [];
    let gamePlayer = {};
    let evenNumPlayer = false;
    let numPlayer = 1;
    let companyNameList = ["companyA", "companyB", "companyC", "companyD", "companyE"]


    
    io.use(async (socket, next) => {
        console.log("io.use");

        const sessionID = socket.handshake.auth.sessionID;
        // 가장 먼저 CONNECTION들어가기 전에 SESSIONID 있는지 확인
        //finding existing session
        const session = await sessionStore.findSession(sessionID);

        if(sessionID){
            socket.sessionID = sessionID;
            socket.userID = session.userID;
            socket.nickname = session.username;
            console.log("io.use 세션 있음", session.userID, sessionID);
            return next();
        }
        // 처음 연결되는 경우 즉, SESSIONID 없으면 
        const username = socket.handshake.auth.username;

        if (!username) {
            return next(new Error("invalid username")); // 새로운 세션 계속 안생기게 해주는 것
            // USERNAME 입력시에만 세션이 만들어짐 
        }
        console.log("io.use 세션 새로 생성", username);
        //create new session
        socket.sessionID = randomId();
        socket.userID = randomId();
        socket.nickname = username;


        // console.log("session 설정 확인 - sessionID", socket.sessionID);
        // console.log("session 설정 확인 - userID", socket.userID);
        // console.log("session 설정 확인 - username", socket.username);
        next();
    });


    io.on('connection', async(socket) => {
        console.log("io-handler.js socket connect!!");
        console.log("socketid : "+ socket.id); 
     
        // console.log("sessionID : "+ socket.sessionID); 
        // console.log("userID : "+ socket.userID); 
 
        console.log("session 설정 확인 - sessionID", socket.sessionID);
        console.log("session 설정 확인 - userID", socket.userID);
        console.log("session 설정 확인 - username", socket.nickname);

    
        try{
            await sessionStore.saveSession(socket.sessionID, {
                userID: socket.userID,
                username: socket.nickname,
                connected: true,
            }).catch( 
            function (error) {
            console.log('catch handler', error);
            });

        }catch(error){
            console.log("ERROR! ", error);
        }

        console.log("connect: saveSession");



         // [StartMain] 
        socket.on('check session', () => {
            var session = { 
                sessionID: socket.sessionID,
                userID: socket.userID,
                username: socket.nickname,
            };
    
            var sessionJSON= JSON.stringify(session);
            socket.emit("session", sessionJSON);
        });




        // [MainHome] pin 번호 입력받아 현재 활성화된 방인지 검증함
        socket.on("isValidRoom", async(room) => {
            console.log('[socket-isValidRoom] room:',room);

            var room_data = { 
                permission: false
            };


            if (await redis_room.IsValidRoom(room)) { // 바꿔야 함
                console.log("permission True");
                socket.room = room;
                room_data.permission = true;
                console.log("room_data.permission : ", room_data.permission );
            }

            var roomJson = JSON.stringify(room_data);
            console.log('!!check roomJson : ', roomJson);
            socket.emit('room permission',roomJson);

        });
        

        // [CreateRoom] 새 방을 만듦
        socket.on("createRoom", async(room) =>{
            console.log('[socket-createRoom] 호출됨, 받은 room 정보 (maxPlayer): ', room);

            // hashtableStore.storeHashTable("key", {"a":"f", 1:2}, 1, 2);
               
            var roomPin = await createRoom('private');
            await initRoom(roomPin);
            // rooms[room.roomPin] = { 
            //     numTotalUsers : 0,
            //     numBlackUsers : 0,
            //     numWhiteUsers : 0,
            //     users : {},  //{socket.id : { socket: socket.id, nickname: socket.nickname, team: evenNumPlayer, status: 0, color: rand_Color}}
            //     manager :  room.manager,
            // }

            // var userPlacement = {
            //     blackPlacement : [4,3,2,1], // Unity 자리 위치 할당 관리 큐
            //     whitePlacement : [4,3,2,1],
            //     toBlackUsers : [], // teamChange 대기 큐(사용자 고유 id 저장)
            //     toWhiteUsers:  []
            // }

            // // redis에 저장
            // jsonStore.storejson(userPlacement, roomPin);
            // const userPlacement_Redis = await jsonStore.getjson(roomPin);
            // console.log("!@#!@#!@", JSON.parse(userPlacement_Redis));



            // console.log("[createRoom] rooms 딕셔너리 : " , rooms);
            // console.log("[createRoom] userPlacement Info : " , userPlacement);
            console.log("succesCreateRoom roomPin: " , roomPin);
            socket.room = roomPin;
            // console.log("socket.room : ", socket.room);


            socket.emit('succesCreateRoom', {
                roomPin: roomPin.toString()
            });
        
        });



        // [WaitingRoom] 
        let addedUser = false; // added 유저 경우 

        // [WaitingRoom] UI player 대응 컴포넌트 idx 할당
        async function PlaceUser(team){
            var userPlacement = JSON.parse(await jsonStore.getjson(socket.room))[0];
            console.log("!!!~~userPlacement : ", userPlacement);

            if(!team){ //false(0)면 black  
                // ++rooms[socket.room].numBlackUsers  ;
                console.log("userPlacement blackPlacement" , userPlacement.blackPlacement);
                var place = userPlacement.blackPlacement.pop();
            }else{
                // ++rooms[socket.room].numWhiteUsers ;
                console.log("userPlacement whitePlacement" , userPlacement.whitePlacement);
                var place =  userPlacement.whitePlacement.pop();
            }

            console.log("[PlaceUser] 반환 team : ", team, " place : ", place); 
            await jsonStore.storejson(userPlacement, socket.room);
            return place

        }

        // [WaitingRoom] UI player 대응 컴포넌트 idx 제거
        async function DeplaceUser(prevTeam, idx){
            var userPlacement = JSON.parse(await jsonStore.getjson(socket.room))[0];
            console.log("!!!~~userPlacement : ", userPlacement);
            console.log("DeplaceUser idx ! : " ,idx , "team : " , prevTeam);

            if(!prevTeam){ // false(0) 면 black팀
                // blackPlayerIdx.Enqueue(idx);
                userPlacement.blackPlacement.push(idx);
                console.log("$$DeplaceUser blackPlacement.length" ,userPlacement.blackPlacement);
            }else{
                // whitePlayerIdx.Enqueue(idx);
                userPlacement.whitePlacement.push(idx);
                console.log("$$DeplaceUser whitePlacement.length" , userPlacement.whitePlacement);
            }

            await jsonStore.storejson(userPlacement, socket.room);
        }

        // [WaitingRoom] 팀 배정
        async function SetTeam(roomInfoJson){

            console.log("SetTeam room: " ,socket.room, roomInfoJson.numBlackUsers, roomInfoJson.numWhiteUsers);
            
            ++roomInfoJson.numTotalUsers;
            if (roomInfoJson.numBlackUsers > roomInfoJson.numWhiteUsers){
                ++roomInfoJson.numWhiteUsers ;
                redis_room.RoomInfo(socket.room,roomInfoJson);
                return true
            }else{
                ++roomInfoJson.numBlackUsers  ;
                redis_room.RoomInfo(socket.room,roomInfoJson);
                return false
            }
            
        }


        // [WaitingRoom] 사용자 첫 입장 시 'add user' emit 
        socket.on('add user', async() => {
        
            console.log('[add user] add user 호출됨 addedUser : ', addedUser, 'user : ', socket.nickname, 'room : ', socket.room );

            if (addedUser) return;

            var room = socket.room;
  
            // 1. users에 저장(닉네임 : 팀 정보)
            const rand_Color = Math.floor(Math.random() * 12);
       
            // 1-2. redis에서 room 정보 불러오기
            var roomInfoJson =  JSON.parse(await redis_room.getRoomInfo(socket.room));
            console.log('!!!~~룸정보', roomInfoJson);
            console.log('!!!~~룸정보[numBlackUsers] : ', roomInfoJson.numBlackUsers);

            // var userPlacement = JSON.parse(await jsonStore.getjson(socket.room));
            // console.log("!!!~~userPlacement : ", userPlacement);


            // 2. blackUsers/whiteUsers에 저장 (playerInfo 저장)
            var team = await SetTeam(roomInfoJson);
            socket.team = team;
            let playerInfo = { 'userID': socket.userID, 'nickname': socket.nickname, 'team': team, 'status': 0, 'color': rand_Color, 'place' : await PlaceUser(team) };
            console.log("PlayersInfo : ", playerInfo);

            redis_room.addMember(socket.room, socket.userID, playerInfo);
            // rooms[room].users[socket.id] = playerInfo;     // evenNumPlayer는 팀 정보


            // 3. socket.join
            socket.join(room);
            addedUser = true;


            // 4. 사용자 로그인 알림 (모든 사용자의 정보를 push함) 
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            var RoomMembersDict = {}
            for (const member of RoomMembersList){
                RoomMembersDict[member] = await redis_room.getMember(room, member);
            }   

            console.log('!!!~~RoomMembersDict', RoomMembersDict);
     

            var room_data = { 
                room : room,
                clientUserID : socket.userID,
                users : RoomMembersDict
            };
            var roomJson = JSON.stringify(room_data);

            console.log('check roomJson : ', roomJson);
            io.sockets.in(room).emit('login',roomJson);

     
            // var playerJson = JSON.stringify(playerInfo);
        //    io.sockets.in(room).emit('user joined', playerInfo);
            socket.broadcast.to(room).emit('user joined', playerInfo);

        });
        

    
        // [WaitingRoom] status 변경 시 
        socket.on('changeReadyStatus',  async(newStatus) =>{
            console.log('changeReadyStatus status : ', newStatus);
            
            // 1. 사용자 정보 수정 
            // var playerInfo = rooms[socket.room].users[socket.id]; 
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            console.log("!PlayersInfo : ", playerInfo);
            playerInfo.status = newStatus;

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);
            // rooms[socket.room].users[socket.id] = playerInfo;     // evenNumPlayer는 팀 정보
            //console.log("수정후! : ",  rooms[socket.room].users[socket.id]);

            // 2. 수정한 내용 client들에게 뿌리기
            var playerJson = JSON.stringify(playerInfo);

            console.log('check playerJson : ', playerJson);
            io.sockets.in(socket.room).emit('updateUI',playerJson);

        });


        // [WaitingRoom] profile 변경 시 
        socket.on('changeProfileColor',  async(colorIndex) =>{
            console.log('changeProfileColor colorIndex : ', colorIndex);
            
            // 1. 사용자 정보 수정 
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            playerInfo.color = colorIndex;
            console.log("PlayersInfo : ", playerInfo);

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);
            console.log("수정 저장완료");
            // rooms[socket.room].users[socket.id] = playerInfo;     // evenNumPlayer는 팀 정보
            // console.log("수정후! : ",  rooms[socket.room].users[socket.id]);

            // 2. 수정한 내용 client들에게 뿌리기
            var playerJson = JSON.stringify(playerInfo);

             console.log('check : ', playerJson);
            // io.sockets.in(socket.room).emit('updateUI',playerJson);
            socket.broadcast.to(socket.room).emit('updateUI', playerJson);

        });  



        // [WaitingRoom] teamChange 변경 시 
        socket.on('changeTeamStatus',  async(changeStatus) =>{
            console.log("_____________________________________________________________________");
            console.log('!!!!changeTeamStatus changeStatus : ', changeStatus);

             // 1. 사용자 정보 수정 
             var playerInfo = await redis_room.getMember(socket.room, socket.userID);
             playerInfo.status = changeStatus;
             console.log("PlayersInfo : ", playerInfo);
 
             await redis_room.updateMember(socket.room, socket.userID, playerInfo);// evenNumPlayer는 팀 정보
            //  console.log("수정후! : ",  rooms[socket.room].users[socket.id]);
            

            var prevTeam = playerInfo.team; // 팀 바꾸기 전 현재 사용자 팀 정보
            var prevPlace = playerInfo.place;
            console.log("## prevTeam : ", prevTeam, "  prevPlace : ", prevPlace );

            // 2. status 상황에 따라 행동 다르게
            // 0이면 teamChange Off
            if (changeStatus == 0){     
                // 2-1. 수정한 내용 client들에게 뿌리기
                var playerJson = JSON.stringify(playerInfo);
                console.log('check : ', playerJson);
                socket.broadcast.to(socket.room).emit('updateUI', playerJson);
            }
            // 2이면 teamChange On
            else if(changeStatus == 2){
                /*
                경우 2가지 : 
                    - 경우 1 : 다른 팀의 자리가 있어서 바로 변경 가능
                    - 경우 2 : full 상태라 1:1로 팀 change를 해야되는 상황 
                ! 추가 처리 사항 !
                    - 입장 시 random시 evenNumPlayer 따른 팀 자동 선택 변수 제어해야 될 듯
                */

                // 0. redis에서 room 정보 불러오기
                var roomInfoJson =  JSON.parse(await redis_room.getRoomInfo(socket.room));
                console.log('!!!~~룸정보', roomInfoJson);



                // 경우 1-1 : 현재 white 팀 -> black 가능한지 확인
                console.log("@roomInfoJson.numBlackUsers : ", roomInfoJson.numBlackUsers);
                console.log("@roomInfoJson.numWhiteUsers : ", roomInfoJson.numWhiteUsers);

                if ((prevTeam == true && roomInfoJson.numBlackUsers <4) || (prevTeam == false && roomInfoJson.numWhiteUsers <4))
                {                
                    // 1. room의 사용자 team 정보 바꾸기
                    // playerInfo.team = false;
                    console.log("[case1] PlayersInfo : ", playerInfo);
                    playerInfo.team = !prevTeam;
                    socket.team = !prevTeam;;
                    playerInfo.status = 0; 

                    // UI 위치 할당
                    await DeplaceUser(prevTeam, prevPlace);
                    playerInfo.place = await PlaceUser(!prevTeam);

                 
                    if(prevTeam){ // white팀이면
                        -- roomInfoJson.numWhiteUsers ; 
                        ++ roomInfoJson.numBlackUsers ; 
                    }else{
                        // black팀이면
                        ++ roomInfoJson.numWhiteUsers ; 
                        -- roomInfoJson.numBlackUsers ; 
                    }

                    // 수정사항 REDIS 저장
                    await redis_room.RoomInfo(socket.room, roomInfoJson);
                    console.log("[찐최종 저장 ] playerInfo : ", playerInfo);
                    await redis_room.updateMember(socket.room, socket.userID, playerInfo);
                    // console.log("####!! blackPlacement" , userPlacement[socket.room].blackPlacement);
                    // console.log("####!! whitePlacement" , userPlacement[socket.room].whitePlacement);



                    // 2. 바뀐 정보 클라쪽에 보내기
                    var changeInfo = { 
                        type : 1,
                        // player1 : playerInfo, // 이전 
                        // player1 : rooms[socket.room].users[socket.id]  // 수정 후
                        player1 : await redis_room.getMember(socket.room, socket.userID)
                    };

                    var teamChangeInfo = JSON.stringify(changeInfo);
                    console.log('check : ', teamChangeInfo);
                    io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);



                    // // 1. room의 사용자 team 정보 바꾸기
                    // // playerInfo.team = false;
                    // console.log("[case1-1] PlayersInfo : ", playerInfo);
                    // rooms[socket.room].users[socket.id].team = false;
                    // rooms[socket.room].users[socket.id].status = 0; 

                    // // UI 위치 할당
                    // DeplaceUser(prevTeam, prevPlace);
                    // rooms[socket.room].users[socket.id].place = PlaceUser(false);
                    // -- rooms[socket.room].numWhiteUsers ; 
                    // ++ rooms[socket.room].numBlackUsers ; 

                    // // 2. 바뀐 정보 클라쪽에 보내기
                    // var teamChangeStatus = JSON.stringify(playerInfo);
                    // console.log('check : ', teamChangeStatus);
                    // io.sockets.in(socket.room).emit('updateTeamChange',teamChangeStatus);
                }

                // // 경우 1-2 : 현재 black 팀 -> white 가능한지 확인
                // if (prevTeam == false && rooms[socket.room].numWhiteUsers <4)
                // {

                //     // 1. room의 사용자 team 정보 바꾸기
                //     // playerInfo.team = true;
                //     console.log("[case1-2] PlayersInfo : ", playerInfo);
                //     rooms[socket.room].users[socket.id].team = true;
                //     rooms[socket.room].users[socket.id].status = 0;

                //     // UI 위치 할당
                //     DeplaceUser(prevTeam, prevPlace);
                //     rooms[socket.room].users[socket.id].place = PlaceUser(true);
                //     ++ rooms[socket.room].numWhiteUsers ; 
                //     -- rooms[socket.room].numBlackUsers ; 

                //     // 2. 바뀐 정보 클라쪽에 보내기
                //     var teamChangeStatus = JSON.stringify(playerInfo);
                //     console.log('check : ', teamChangeStatus);
                //     io.sockets.in(socket.room).emit('updateTeamChange',teamChangeStatus);
                // }


                // 경우 2 : full 상태라 1:1로 팀 change를 해야되는 상황 
                // 과정 1 : 대기열 큐에 ADD
                //// <<<수정 필요>>
                else if (roomInfoJson.numWhiteUsers >= 4 ||roomInfoJson.numBlackUsers >= 4) // 꽉 찬 상황이면 queue에 저장 (조정 : if문 걍 없애도 될듯)
                {

                    var userPlacement = JSON.parse(await jsonStore.getjson(socket.room))[0];
                     // 1. 대기열에 저장 
                    if (prevTeam == false){ // 현재 black이니까 white 팀으로 변경하고자 함
                        userPlacement.toWhiteUsers.push(socket.id);
                    }
                    else{ // 현재 white이니까 black 팀으로 변경하고자 함
                        userPlacement.toBlackUsers.push(socket.id);
                    }

                    // 2. 매칭 하기
                    if (userPlacementuserPlacement.toBlackUsers.length > 0 && userPlacement.toWhiteUsers.length > 0 ){
                        var matchPlayer1Id = userPlacement.toBlackUsers.shift();
                        var matchPlayer2Id = userPlacement.toWhiteUsers.shift();
                        // var matchPlayerId = userPlacement[room.roomPin].toWhiteUsers.Dequeue();

                        var matchPlayer1 = rooms[socket.room].users[matchPlayer1Id];
                        var matchPlayer2 = rooms[socket.room].users[matchPlayer2Id];


                        // 3. 변수 바꾸기 (numWhite, toBlackUsers, playerInfo)
                        console.log('변경전 rooms[socket.room].users[matchPlayer1Id] : ', matchPlayer1);
                        console.log('변경전 rooms[socket.room].users[matchPlayer2Id] : ', matchPlayer2);
                    
                        // 2) place & team 변경
                        DeplaceUser(matchPlayer1.team, matchPlayer1.place);
                        DeplaceUser(matchPlayer2.team, matchPlayer2.place);

                        matchPlayer1.team = !matchPlayer1.team
                        matchPlayer2.team = !matchPlayer2.team

                        matchPlayer1.place = PlaceUser(matchPlayer1.team);
                        matchPlayer2.place = PlaceUser(matchPlayer2.team);

                        // 3) 변경사항 저장
                        rooms[socket.room].users[matchPlayer1Id] = matchPlayer1;
                        rooms[socket.room].users[matchPlayer2Id] = matchPlayer2;

                        console.log('변경후 rooms[socket.room].users[matchPlayer1Id] : ', rooms[socket.room].users[matchPlayer1Id]);
                        console.log('변경후 rooms[socket.room].users[matchPlayer2Id] : ', rooms[socket.room].users[matchPlayer2Id]);


                        var changeInfo = { 
                            type : 2,
                            player1 : rooms[socket.room].users[matchPlayer1Id], // player1
                            player2 : rooms[socket.room].users[matchPlayer2Id]   // player2
                        };

                        var teamChangeInfo = JSON.stringify(changeInfo);
                        console.log('check : ', teamChangeInfo);
                        io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);
                    }
                }
            }
            
        });  

        // [WaitingRoom] 게임 스타트 누를 시에 모든 유저에게 전달
        socket.on('Game Start',  async() =>{
            // 사용자 정보 팀 별로 불러오기
            var blackUsersID = []; 
            var whiteUsersID = [];
            
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            for (const member of RoomMembersList){
                var playerInfo = await redis_room.getMember(socket.room, member);
                if (playerInfo.team == false) {
                    blackUsersID.push(playerInfo.userID);
                }
                else {
                    whiteUsersID.push(playerInfo.userID);
                }
            }
            console.log("whiteUsersID 배열 : ", whiteUsersID);
            console.log("blackUsersID 배열 : ", blackUsersID);
               
            // 게임 관련 Json 생성 (new)
            var roomTotalJson = InitGame(socket.room, blackUsersID, whiteUsersID);

            // redis에 저징
            jsonStore.storejson(roomTotalJson, socket.room);

            io.sockets.in(socket.room).emit('onGameStart');
        });



        // [MainGame] 게임 시작시 해당 룸의 사용자 정보 넘김
        socket.on('InitGame',  async() =>{
            // var sectionDB = {
            //     roomPin : socket.room,
            //     sectionInfo : []
            // }

            const roomjson_Redis = await jsonStore.getjson(socket.room);
            console.log("roomjson_Redis : ", JSON.parse(roomjson_Redis));

            var pitaNum;
            if (socket.team == true){
                pitaNum = roomjson_Redis[0]["whiteTeam"]["total_pita"];
            } else {
                pitaNum = roomjson_Redis[0]["blackTeam"]["total_pita"];
            }

            var room_data = { 
                teamName : socket.team,
                pita : pitaNum
            };
            var roomJson = JSON.stringify(room_data);


            console.log("Team 정보 :", socket.team);
            console.log("room 정보 :", socket.room);
            console.log("roomJson!! :",roomJson);
            io.sockets.in(socket.room).emit('MainGameStart',roomJson);
        });
        


        // 무력화 test
        socket.on('TestNeutralization', function() {
            console.log("[On] TestNeutralization");
            console.log("[Emit] OnNeutralization");
            // io.sockets.in(socket.room).emit('OnNeutralization');
            var test = { 
                test : test
            };
            var testJson = JSON.stringify(test);
            socket.emit('OnNeutralization', testJson);
        });


        // 무력화 해결 시도 시
        socket.on('Try Non-neutralization', async(room)=> {
            console.log("[On] Solve Neutralization");
          
            //  json 불러와서 해당 영역 회사 경고 초기화 함 
            var roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("JSON!!!",roomTotalJson);
            
            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
            console.log("blackTeam.total_pita!!!", black_total_pita );

            // 가격화 
            if (black_total_pita - config.UNBLOCK_INFO.pita < 0){
                // 실패시
                console.log("failed");
                socket.emit('Failed Neutralization');
            }
            else{
                console.log("solved");
                // json 변경
                roomTotalJson[0].blackTeam.total_pita = black_total_pita - 100;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // 확인
                var roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("UPDATE 후에 JSON!!!",roomTotalJson[0]);
                
                // 성공시 
                socket.emit('Solved Neutralization');
            }

        });

        ////////////////////////////////////////////////////////////////////////////////////
        // PlayerEnter
        // socket.on('PlayerEnter', function() {
        //     console.log("Players >> ");
        //     const rand_Color = Math.floor(Math.random() * 12);
        //     // eval("Players.player" + numPlayer + " = playerInfo")
        //     let playerOrder = "player" + numPlayer;
        //     let playerInfo = {playerOrder: playerOrder, socket: socket.id, nickname: socket.nickname, readyStatus: false, teamStatus: false, team: evenNumPlayer, color: rand_Color};
        //     Players.push(playerInfo);
        //     gamePlayer.player = Players;
        //     // Players[Players.length]=playerInfo;
        //     console.log("PlayersInfo", numPlayer, " >> ", playerInfo);
        //     console.log("Players >> ", Players);
        //     console.log("gamePlayer >> ", gamePlayer);

        //     if (evenNumPlayer == false){
        //         evenNumPlayer = true;
        //     } else {
        //         evenNumPlayer = false;
        //     }

        //     numPlayer = numPlayer + 1;
            
        //     // JSON 형식으로 유니티에 데이터 보내기

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });
        
        // socket.on('changeStatus', function(jsonStr) {
        //     let changePlayerInfo = JSON.parse(jsonStr);        
    
        //     console.log('new Player info Jsong string : ', jsonStr);
        //     console.log('new Player info gamePlayer : ', changePlayerInfo);

        //     let playerNum = changePlayerInfo["playerNum"];
        //     let ready = (changePlayerInfo["readyStatus"] == 'True') ? true : false;
        //     let teamChange = (changePlayerInfo["teamStatus"] == 'True') ? true : false;

        //     gamePlayer.player[playerNum]["readyStatus"] = ready;
        //     gamePlayer.player[playerNum]["teamStatus"] = teamChange;

        //     console.log("new josn file : ", gamePlayer);

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });

        // socket.on('changeColor', function(jsonStr) {
        //     let changePlayerInfo = JSON.parse(jsonStr);

        //     console.log('new Player info Jsong string : ', jsonStr);
        //     console.log('new Player info gamePlayer : ', changePlayerInfo);

        //     let playerNum = changePlayerInfo["playerNum"];
        //     let colorNum = changePlayerInfo["value"];

        //     gamePlayer.player[playerNum]["color"] = colorNum;

        //     console.log("new josn file : ", gamePlayer);

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });

        // 게임 카드 리스트 보내기
        socket.on("Load Card List", async(teamData) => {
            // var loadInfo = {roomPin : socket.room, teamName : teamName, company : "companyA"};
            // console.log("loadInfo json : ", loadInfo);
            
            let teamDataJson = JSON.parse(teamData);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("load card list roomTotalJson : ", roomTotalJson);
            console.log("Load card list teamData : ", teamDataJson);
            var returnValue;

            if (teamDataJson.teamName == true) {
                returnValue = roomTotalJson[0][teamDataJson.companyName]["penetrationTestingLV"];
            } else {
                returnValue = roomTotalJson[0][teamDataJson.companyName]["attackLV"];
            }

            console.log("Load Card List Return Value : ", returnValue);
            socket.to(socket.room).emit("Card List", returnValue);
            socket.emit("Card List", returnValue);

            // // 나중에 실제 입력한 pin 번호로 바꾸기! (mongodb 버전)
            // func.loadCardList(loadInfo).then(function (attackList){
            //     console.log('[socket-loadCardList] attak list[0] : ', attackList);
                
            //     var AttackTableJson = JSON.stringify(attackList);

            //     console.log('[socket-loadCardList] attak list : ', AttackTableJson);
            //     socket.to(socket.room).emit("Attack List", AttackTableJson);
            //     // socket.emit("Attack List", AttackTableJson);
            // });
        });

        socket.on("Click Response", async(data) => {    // 다음주 할 일 (공격 누르면 섹션 띄워 선택하기)
            console.log("Click Response jsonStr : ", data);

            // let responseJson = JSON.parse(data);

            // const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            // console.log("Click Response roomTotalJson : ", roomTotalJson);
            // console.log("Click Response responseJson : ", responseJson);

            // if (responseJson.teamName == true) {
            //     roomTotalJson[0][responseJson.companyName]["sections"];
            // } else {
            //     returnValue = roomTotalJson[0][responseJson.companyName]["attackLV"];
            // }



            // var returnValue;
        });


        socket.on("Click Upgrade Attack", async(jsonStr) => {
            let upgradeAttackInfo = JSON.parse(jsonStr);

            var roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Update card list roomTotalJson : ", roomTotalJson);
            console.log("Update card list upgradeAttackInfo : ", upgradeAttackInfo);

            var cardLv;
            if (upgradeAttackInfo.teamName == true) {
                cardLv = roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"][upgradeAttackInfo.attackIndex];
                roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"][upgradeAttackInfo.attackIndex] += 1;
                eval("roomTotalJson[0]['whiteTeam']['total_pita'] -= config.ATTACK_" + (upgradeAttackInfo.attackIndex + 1) + "['pita'][" + cardLv + "];");
            } else {
                cardLv = roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"][upgradeAttackInfo.attackIndex];
                roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"][upgradeAttackInfo.attackIndex] += 1;
                eval("roomTotalJson[0]['blackTeam']['total_pita'] -= config.RESEARCH_" + (upgradeAttackInfo.attackIndex + 1) + "['pita'][" + cardLv + "];");
            }

            console.log("Update card list roomTotalJson : ", roomTotalJson[0][upgradeAttackInfo.companyName]);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Update card list update roomTotalJson : ", roomTotalJson);
            var returnValue;

            if (upgradeAttackInfo.teamName == true) {
                returnValue = roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"];
            } else {
                returnValue = roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"];
            }

            console.log("Update Card List Return Value : ", returnValue);
            socket.to(socket.room).emit("Card List", returnValue);
            socket.emit("Card List", returnValue);

            socket.to(socket.room).emit("Load Pita Num", returnValue);
            socket.emit("Pita Num", returnValue);

            // console.log('[socket-loadAttackList] upgrade Attack Info : ', upgradeAttackInfo);
            // let attackIndex = upgradeAttackInfo["AttackIndex"];
            // let roomPin = socket.room;
            // let team = upgradeAttackInfo["team"];
            // var loadInfo = {roomPin : roomPin, teamName : team};

            // func.loadAttackList(loadInfo).then(function (attackList){
            //     var attackActivity = attackList["attackCard"][attackIndex]["activity"];
            //     var attackLevel = attackList["attackCard"][attackIndex]["level"];
            //     console.log('[socket-loadAttackList] attackList["attackCard"][AttackIndex]["level"] : ', attackLevel);

            //     var beforeAttackLevel = { attackNum: attackIndex, activity: attackActivity, level: attackLevel };
            //     var newAttackLevel = { attackNum: attackIndex, activity: true, level: attackLevel+1 };
            //     var upgradeDataJson = { roomPin : roomPin, teamName: team, beforeAttackLevel : beforeAttackLevel, newAttackLevel : newAttackLevel };
                
            //     func.upgradeAttackLevel(upgradeDataJson).then(function(updateDBInfo){
            //         console.log('[socket-loadAttackList] attackList : ', updateDBInfo);

            //         if (updateDBInfo["acknowledged"]){
            //             func.loadAttackList(loadInfo).then(function (attackList){
            //                 console.log('[socket-loadAttackList] attak list[0] : ', attackList);
                            
            //                 var AttackTableJson = JSON.stringify(attackList);

            //                 console.log('[socket-loadAttackList] attak list : ', AttackTableJson);
            //                 socket.to(socket.room).emit("Attack List", AttackTableJson);
            //                 socket.emit("Attack List", AttackTableJson);
            //             });
            //         } else {
            //             console.log('upgradeAttackLevel Failed');
            //         }
            //     });

                // socket.emit("Attack List", AttackTableJson);
            // });

            // roompin이랑 attack index 번호를 json 형식으로 보낼 것 { roomPin : roomPin, attackIndex : attackIndex }
            

        });


        // 회사 몰락 여부 확인
        socket.on('On Main Map', async() => {
            var roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("On Main Map roomTotalJson : ", roomTotalJson);

            var abandonStatusList = [];
            for(var company of companyNameList){
                abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
            }

            console.log("On Main Map abandonStatusList : ", abandonStatusList);
            socket.emit('Company Status', abandonStatusList);

            // // let comapny_abandonStatus = {companyA: true, companyB: false, companyC: false, companyD: false, companyE: false};
            // let comapny_abandonStatus = [true, false, false, false, false];
            // // var companyStatusJson = JSON.stringify(comapny_abandonStatus);
            // console.log("jsonStringify : ", comapny_abandonStatus.toString());
            // socket.to(socket.room).emit("Company Status", comapny_abandonStatus);
            // socket.emit('Company Status', comapny_abandonStatus);


        })
        
        // 회사 차단 인원 확인 (현제 test로 하드코딩 하여 추후 json에서 가져와 수정해야 함)
        // 다음주에 해야 됨
        socket.on('On Monitoring', function() {
            // let comapny_abandonStatus = {companyA: true, companyB: false, companyC: false, companyD: false, companyE: false};
            let company_blockedNum = 2;
            // var companyStatusJson = JSON.stringify(comapny_abandonStatus);
            socket.to(socket.room).emit("Blocked Num", company_blockedNum);
            socket.emit('Blocked Num', company_blockedNum);


        })


// ===================================================================================================================
        // ## [Section] 영역 클릭 시 
        socket.on('Section_Name', async(data) => {
            console.log('[Section - Click Section] Click Area Info  : ', data);
            data = JSON.parse(data);

            var PIN = socket.room;
            console.log("[Section - Click Section] PIN : ", PIN);

            var corp = data.Corp;
            var areaName = data.area;

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         corpName = "companyA"
            //         break;
            //     case "회사B":
            //         corpName = "companyB"
            //         break;
            //     case "회사C":
            //         corpName = "companyC"
            //         break;
            //     case "회사D":
            //         corpName = "companyD"
            //         break;
            //     case "회사E":
            //         corpName = "companyE"
            //         break;
            // }

            sectionIdx = -1;
            switch(areaName)
            {
                case "Area_DMZ":
                    sectionIdx = 0;
                    break;
                case "Area_Interal":
                    sectionIdx = 1;
                    break;
                case "Area_Sec":
                    sectionIdx = 2;
                    break;
            }

            var white_total_pita = roomTotalJson[0].whiteTeam.total_pita;
            console.log("Before White total_pita!!!", white_total_pita );
            // MAINTENANCE_SECTION_INFO : { pita : [5, 6, 7, 8, 9], time : [5, 4, 3, 2, 1] },
            

            if(white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level] < 0)
            {
                console.log("피타 부족");
            } else {
                // json 변경
                roomTotalJson[0].whiteTeam.total_pita = white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level];
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // 확인
                var roomTotalJsonA = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("UPDATE 후에 JSON!!!",roomTotalJsonA[0]);

                console.log("After White total_pita!!!", white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level] );

                // console.log("#############load card list roomTotalJson############## : ", roomTotalJson[0][corpName]);
                // console.log("############# Before Level ############## : ", roomTotalJson[0][corpName].sections[sectionIdx].level);
                roomTotalJson[0][corpName].sections[sectionIdx].level += 1;
                //console.log("############# After Level ############## : ", roomTotalJson[0][corpName].sections[sectionIdx]);

                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // 새 RoomTotal 확인
                const NewRoomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("================= After UPDATE ================= : ", NewRoomTotalJson[0][corpName].sections[sectionIdx]);

                

                var area_level = areaName + "-" + (roomTotalJson[0][corpName].sections[sectionIdx].level);
                socket.to(socket.room).emit("New_Level", area_level.toString());
                socket.emit('New_Level', area_level.toString());


                // // 해당 영역의 레벨을 DB에서 read
                // func.SelectSectionLevel(PIN, corp, areaName).then(function (arr){
                //     var specific = arr[0];
                //     var index = arr[1];
                //     console.log("[SelectSectionLevel] before level >> ", specific[0].sectionInfo[index]);
                //     var selectedSectionInfo = specific[0].sectionInfo[index];
                //     //selectedSectionInfo = JSON.parse(selectedSectionInfo);
                //     var newLevel = {Corp: selectedSectionInfo.Corp, area: selectedSectionInfo.area, level: selectedSectionInfo.level+1, vuln: selectedSectionInfo.vuln};
                //     console.log("[SelectSectionLevel] after level >> ", newLevel);

                //     // 레벨 수정(1증가)
                //     func.UpdateSection(PIN, corp, areaName, selectedSectionInfo, newLevel);   
                //     var area_level = areaName + "-" + (selectedSectionInfo.level+1);
                //     socket.emit('New_Level', area_level.toString());
                // });
            }


            
        });

        // ## [Section] 구조도 페이지 시작 시
        socket.on('Section_Start', async (corp) => {
            // console.log('[Section] Corp_Name  : ', cropName);
            // var PIN = socket.room;
            // console.log("[Section] PIN : ", PIN);

            console.log("Section_Start CALLED >> ");
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("WHTWHYWYHWYHWYHWYH 1 >> ", roomTotalJson[0]);

            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         corpName = "companyA"
            //         break;
            //     case "회사B":
            //         corpName = "companyB"
            //         break;
            //     case "회사C":
            //         corpName = "companyC"
            //         break;
            //     case "회사D":
            //         corpName = "companyD"
            //         break;
            //     case "회사E":
            //         corpName = "companyE"
            //         break;
            // }
            console.log("WHTWHYWYHWYHWYHWYH CP NAME >> ", corp);
            console.log("WHTWHYWYHWYHWYHWYH CP NAME >> ", corpName);

            console.log("WHTWHYWYHWYHWYHWYH >> ", roomTotalJson[0][corpName]);
            var sectionsArr = roomTotalJson[0][corpName].sections;
            console.log("### LENGTH ### >> ", sectionsArr.length);

            for(var i=0; i<sectionsArr.length; i++){
                var areaName = ['Area_DMZ', 'Area_Interal', 'Area_Sec'];
                var sectionInfo = { Corp: corpName, area: areaName[i], level: roomTotalJson[0][corpName].sections[i].level, vuln: roomTotalJson[0][corpName].sections[i].vuln}
                console.log("[Section] sectionInfo-detail", sectionInfo);
                socket.to(socket.room).emit("Area_Start_Emit", JSON.stringify(sectionInfo));
                socket.emit('Area_Start_Emit', JSON.stringify(sectionInfo));
                /*
                [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_DMZ', level: 0, vuln: 3 }
                [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_Interal', level: 0, vuln: 1 }
                [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_Sec', level: 0, vuln: 2 }
                */
            }

            // func.SelectCrop(PIN, cropName).then(function (data){
            //    // console.log("[Section] Corp data >> ", data);

            //     for(var i=0; i<data.length; i++){
            //         console.log("[Section] sectionInfo-detail", data[i]);
            //         socket.emit('Area_Start_Emit', JSON.stringify(data[i]));
            //         /*
            //         [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_DMZ', level: 0, vuln: 3 }
            //         [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_Interal', level: 0, vuln: 1 }
            //         [Section] sectionInfo-detail { Corp: '회사B', area: 'Area_Sec', level: 0, vuln: 2 }
            //         */
            //     }
            // });
        });

        // ## [Vuln] 영역 클릭 시 
        socket.on('Get_Vuln', async (data) => {
            console.log('[Vuln] Click Area_Name  : ', data);
            data = JSON.parse(data);
            //var PIN = socket.room;
            var corp = data.Corp;
            var areaName = data.area;

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         corpName = "companyA"
            //         break;
            //     case "회사B":
            //         corpName = "companyB"
            //         break;
            //     case "회사C":
            //         corpName = "companyC"
            //         break;
            //     case "회사D":
            //         corpName = "companyD"
            //         break;
            //     case "회사E":
            //         corpName = "companyE"
            //         break;
            // }

            sectionIdx = -1;
            switch(areaName)
            {
                case "Area_DMZ":
                    sectionIdx = 0;
                    break;
                case "Area_Interal":
                    sectionIdx = 1;
                    break;
                case "Area_Sec":
                    sectionIdx = 2;
                    break;
            }

            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
            console.log("Before black_total_pita!!!", black_total_pita );

            if(black_total_pita - config.EXPLORE_INFO.pita < 0)
            {
                console.log("피타 부족");
            } else {
                // json 변경
                roomTotalJson[0].blackTeam.total_pita = black_total_pita - config.EXPLORE_INFO.pita;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // 확인
                var roomTotalJsonA = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("UPDATE 후에 JSON!!!",roomTotalJsonA[0]);

                console.log("After black_total_pita!!!", black_total_pita - config.EXPLORE_INFO.pita);
                socket.to(socket.room).emit("Area_Vuln", areaName, roomTotalJson[0][corpName].sections[sectionIdx].vuln);
                socket.emit('Area_Vuln', areaName, roomTotalJson[0][corpName].sections[sectionIdx].vuln);

            }

            



            // // 해당 영역의 취약점을 DB에서 read
            // func.SelectSectionVuln(PIN, corp, area).then(function (data){
            //     socket.emit('Area_Vuln', data.area, data.vuln);
            // });

        });

        // Section Destroy TEST
        socket.on('Get_Section_Destroy_State', async(corp) => {
            //testData = { "sections": [{"destroyStatus": true, "level": 5}, {"destroyStatus": false, "level": 3}, {"destroyStatus": false, "level": 1}]}
            //testData = JSON.parse(testData);
            console.log('Get_Section_Destroy_State CALLED  : ', corp);
            
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         var corpName = "companyA"
            //         break;
            //     case "회사B":
            //         var corpName = "companyB"
            //         break;
            //     case "회사C":
            //         var corpName = "companyC"
            //         break;
            //     case "회사D":
            //         var corpName = "companyD"
            //         break;
            //     case "회사E":
            //         var corpName = "companyE"
            //         break;
            // }

            console.log("@@@@@@@@ Destroy State @@@@@@@ ",  roomTotalJson[0][corpName].sections);
            var sections = {sections: roomTotalJson[0][corpName].sections};
            socket.to(socket.room).emit("Section_Destroy_State", JSON.stringify(sections));
            socket.emit('Section_Destroy_State', JSON.stringify(sections));
            

            // socket.emit('Section_Destroy_State', JSON.stringify(testData));
        });

        // Section Attacked Name TEST
        socket.on('Get_Section_Attacked_Name', async(corp) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            
            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         var corpName = "companyA"
            //         break;
            //     case "회사B":
            //         var corpName = "companyB"
            //         break;
            //     case "회사C":
            //         var corpName = "companyC"
            //         break;
            //     case "회사D":
            //         var corpName = "companyD"
            //         break;
            //     case "회사E":
            //         var corpName = "companyE"
            //         break;
            // }

            console.log("@@@@@@@@ Destroy State @@@@@@@ ",  roomTotalJson[0][corpName].sections);
            var sections = {sections: roomTotalJson[0][corpName].sections}
            //testData = { "sections": [{"attack": {"progress": [5,4,1,2,3], "last": 12}}, {"attack": {"progress": [5,4,1,2,3], "last": 10}}, {"attack": {"progress": [5,4,1,2,3], "last": -1}}]}
            //testData = JSON.parse(testData);
            //console.log('Get_Section_Attacked_Name CALLED  : ', testData);

            socket.to(socket.room).emit("Section_Attacked_Name", JSON.stringify(sections));
            socket.emit('Section_Attacked_Name', JSON.stringify(sections));

            //socket.emit('Section_Attacked_Name', JSON.stringify(testData));
        });

        // [Monitoring] 관제 issue Count
        socket.on('Get_Issue_Count', async(corp) => {            
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            // switch(corp)
            // {
            //     case "회사A":
            //         var corpName = "companyA"
            //         break;
            //     case "회사B":
            //         var corpName = "companyB"
            //         break;
            //     case "회사C":
            //         var corpName = "companyC"
            //         break;
            //     case "회사D":
            //         var corpName = "companyD"
            //         break;
            //     case "회사E":
            //         var corpName = "companyE"
            //         break;
            // }
            var cntArr = [];
            for(i=0; i<3; i++)
            {
                var sectionData = roomTotalJson[0][corpName].sections[i].attack.progress.length;
                cntArr[i] = sectionData;
            }

            console.log("############# issue cOUNT############## : ", cntArr);
            socket.to(socket.room).emit("Issue_Count", cntArr);
            socket.emit('Issue_Count', cntArr);
            //roomTotalJson[0][corpName].sections[sectionIdx].level

            // console.log("#############load card list roomTotalJson############## : ", roomTotalJson[0][corpName]);
            // console.log("############# Before Level ############## : ", roomTotalJson[0][corpName].sections[sectionIdx].level);
            //roomTotalJson[0][corpName].sections[sectionIdx].level += 1;
            //console.log("############# After Level ############## : ", roomTotalJson[0][corpName].sections[sectionIdx]);

        });
// ===================================================================================================================
        
        socket.on('disconnect', function() {
            console.log('A Player disconnected!!!');
        });
    })

    function randomN(){
        var randomNum = {};
        //0~9까지의 난수
    
        randomNum.random = function(n1, n2) {
            return parseInt(Math.random() * (n2 -n1 +1)) + n1;
        };
    
        var value = "";
        for(var i=0; i<5; i++){
            value += randomNum.random(0,9);
        }
        return value;
        
    };


    function nowDate(){
        var today = new Date();
        var year = today.getFullYear();
        var month = ('0' + (today.getMonth() + 1)).slice(-2);
        var day = ('0' + today.getDate()).slice(-2);
        
        var today = new Date();   
        var hours = ('0' + today.getHours()).slice(-2); 
        var minutes = ('0' + today.getMinutes()).slice(-2);
        var seconds = ('0' + today.getSeconds()).slice(-2); 
        
        var dateString = year + '-' + month  + '-' + day;
        var timeString = hours + ':' + minutes  + ':' + seconds;
    
        var now_date = dateString + " " + timeString;
        return now_date;
    };


    async function createRoom(roomType){
        var roomPin = randomN();

        var room_info = {
            'creationDate' : nowDate(),
            'roomType' : roomType,
            'numBlackUsers' : 0,
            'numWhiteUsers' : 0,
        };

        await redis_room.createRoom(roomPin, room_info);

        return roomPin
    };


    async function initRoom(roomPin){
        var userPlacement = {
            blackPlacement : [4,3,2,1], // Unity 자리 위치 할당 관리 큐
            whitePlacement : [4,3,2,1],
            toBlackUsers : [], // teamChange 대기 큐(사용자 고유 id 저장)
            toWhiteUsers:  []
        }

        // redis에 저장
        jsonStore.storejson(userPlacement, roomPin);
        const userPlacement_Redis = await jsonStore.getjson(roomPin);
        console.log("!@#!@#!@", JSON.parse(userPlacement_Redis));
    };




    function InitGame(room_key, blackUsersID, whiteUsersID){
        console.log("INIT GAME 호출됨------! blackUsersID", blackUsersID);
        /*
            var blackUsers = [ user1ID, user2ID, user3ID ];
        */

        // RoomTotalJson 생성 및 return 
        var userCompanyStatus = new UserCompanyStatus({
            warnCnt    : 0,
            detectCnt : 0
        });


        var blackUsers = {};
        var whiteUsers = {};

        for (const user of blackUsersID){
            blackUsers[user] = new BlackUsers({
                userId   : user,
                IsBlocked   : false,
                currentLocation : 0,
                companyA    : userCompanyStatus,
                companyB    : userCompanyStatus,
                companyC    : userCompanyStatus,
                companyD    : userCompanyStatus,
                companyE    : userCompanyStatus,
            });
        }

        for (const user of whiteUsersID){
            whiteUsers[user] =  new WhiteUsers({
                userId   :"abc123",
                IsBlocked   : false,
                currentLocation : 0,
            })
        }

    
        var progress = new Progress({
            progress  : [],
            last  : -1
        })

        var initCompany = new Company({
            abandonStatus : false,
            penetrationTestingLV : [1,1,1,1,1,1,1,1,1,1,1,1,1],
            attackLV : [0,0,0,0,0,0,0,0,0,0,0,0,0],
            sections : [
                new Section({
                destroyStatus  : false ,
                level  : 0,
                vuln : 0,
                attack : progress,
                response : progress,
                }),

                new Section({
                    destroyStatus  : false ,
                    level  : 0,
                    vuln : 1,
                    attack : progress,
                    response : progress,
                }),

                new Section({
                    destroyStatus  : false ,
                    level  : 0,
                    vuln : 2,
                    attack : progress,
                    response : progress,
                }),
            ]
        });


        var RoomTotalJson  = {
            roomPin : room_key,
            server_start  : new Date(),
            server_end  :  new Date(),
            blackTeam  : new BlackTeam({ 
                total_pita : 500,
                users : blackUsers
            }),
            whiteTeam  : new WhiteTeam({ 
                total_pita : 500,
                users : whiteUsers
            }),
            companyA    : initCompany,
            companyB    : initCompany,
            companyC    : initCompany,
            companyD    : initCompany,
            companyE    : initCompany,
        };
        // console.log("whiteUsers ", whiteUsers);
        // console.log("blackUsers ", blackUsers);
        // console.log("companyA ", initCompany);
        // console.log("ROOMJSON RoomTotalJson", RoomTotalJson);
        return RoomTotalJson
    }
    
}

